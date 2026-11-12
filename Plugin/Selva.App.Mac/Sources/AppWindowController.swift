import AppKit
import WebKit

/// The app's one window. A web view fills it and shows either the app's own page (launcher,
/// progress, key prompt, errors) or the session page that the plug-in serves from Rhino.
final class AppWindowController: NSObject {
    private static let hostCommandScheme = "selva-panel"
    private static let openCommand = "open"
    private static let shellHandler = "selvaShell"
    private static let startingRhino = "StartingRhino"
    private static let loadingGrasshopper = "LoadingGrasshopper"

    // Rhino's own launcher gives a definition 30 seconds to show its UI after it has loaded
    // Grasshopper and solved once. This is the outer limit for all of that on a cold machine.
    private static let openTimeout: TimeInterval = 240

    private static let firstSize = NSSize(width: 1180, height: 820)
    private static let frameName = "Selva"

    let window: NSWindow

    /// Opened with a file from Finder: the window is that app, and closing the app closes the
    /// window.
    private var isFixed: Bool

    /// The file being opened came from Finder while the window was up. The window becomes that
    /// app when its session shows, not before: an open that fails still offers the launcher.
    private var opensAsApp = false

    private let webView: WKWebView
    private var openTimer: Timer?

    private var rhino: RhinoHost?
    private var rhinoReady = false

    // From startOpen until the session shows or the open fails.
    private var opening = false

    // Where each download in flight is written, and where the user asked for it.
    private var downloads: [ObjectIdentifier: (written: URL, destination: URL)] = [:]

    // The app's page is loaded and takes state; or it was asked for and hasn't said "ready" yet.
    private var shellLoaded = false
    private var shellNavigating = false
    private var shellState: [String: Any] = [:]
    private var sessionURL: URL?

    private var path: String?
    private var key: String?
    private var appFile: AppFileInfo?
    private var name = ""

    init(startPath: String?) {
        isFixed = startPath != nil
        webView = PlainWebView(frame: NSRect(origin: .zero, size: Self.firstSize), configuration: WKWebViewConfiguration())
        window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.firstSize),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        super.init()

        window.title = "Selva"
        window.isReleasedWhenClosed = false
        window.contentMinSize = NSSize(width: 420, height: 480)
        window.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(white: 10 / 255, alpha: 1)
                : NSColor(white: 250 / 255, alpha: 1)
        }
        // The title bar takes the window's colour, which is the page's: one surface, no seam.
        window.titlebarAppearsTransparent = true
        window.contentView = webView
        window.delegate = self
        window.center()
        window.setFrameAutosaveName(Self.frameName)

        // The window's colour shows until a page has painted, not WebKit's white.
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.configuration.userContentController.add(ShellMessages(self), name: Self.shellHandler)

        window.makeKeyAndOrderFront(nil)
        if let startPath {
            open(startPath)
        } else {
            showLauncher()
        }
    }

    // ============================================================================
    // Opening
    // ============================================================================

    /// A file from Finder while the window is up.
    func openAsApp(_ file: String) {
        open(file, asApp: true)
    }

    private func open(_ file: String, asApp: Bool = false) {
        abandonOpen()
        opensAsApp = asApp
        let url = URL(fileURLWithPath: file).standardizedFileURL
        path = url.path
        key = nil
        appFile = nil
        name = url.deletingPathExtension().lastPathComponent

        guard FileManager.default.fileExists(atPath: url.path) else {
            showError("\(url.lastPathComponent) doesn't exist any more.", canRetry: false)
            return
        }

        applyAppIcon(nil)
        if AppFile.hasMagic(path: url.path) {
            let bytes: Data
            do {
                bytes = try Data(contentsOf: url)
            } catch {
                showError("\(url.lastPathComponent) couldn't be read: \(error.localizedDescription)", canRetry: true)
                return
            }

            switch AppFile.read(bytes) {
            case .failure(let refusal):
                showError(refusal.message, canRetry: false)
                return

            case .success(let info):
                appFile = info
                name = info.name
                applyAppIcon(info.iconPng)
                if info.encrypted {
                    key = KeyStore.read(keyId: info.keyId)
                    if key == nil {
                        window.title = name
                        setShell("key", ["name": name, "error": NSNull()])
                        return
                    }
                }
            }
        }

        window.title = isFixed || opensAsApp ? name : "\(name) - Selva"
        startOpen()
    }

    /// Rhino can't be told to drop an open it has taken, and its answers don't say which open
    /// they are for. Only a new Rhino keeps this one's session out of the next file's window.
    private func abandonOpen() {
        let taken = openTimer != nil
        endOpen()
        if taken {
            dropRhino()
        }
    }

    private func onKeyEntered(_ typed: String, remember: Bool) {
        guard let expected = appFile?.keyId, let file = path else {
            return
        }

        // The id is a slow hash by design, so it's worked out off the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            let id = AppFileKey.idOf(typed)
            DispatchQueue.main.async { [self] in
                guard path == file, appFile?.keyId == expected else {
                    return
                }

                guard id == expected else {
                    setShell("key", ["name": name, "error": "That key doesn't open this app."])
                    return
                }

                if remember {
                    KeyStore.write(keyId: expected, key: typed)
                }

                key = typed
                startOpen()
            }
        }
    }

    private func startOpen() {
        stopOpenTimer()
        opening = true

        if rhino == nil {
            rhinoReady = false
            let host = RhinoHost()
            host.onMessage = { [weak self, weak host] message in
                if let self, self.rhino === host {
                    self.onRhinoMessage(message)
                }
            }
            host.onFailed = { [weak self, weak host] message in
                if let self, self.rhino === host {
                    self.onRhinoFailed(message)
                }
            }
            rhino = host
            host.start()
        }

        if rhinoReady {
            sendOpen()
        } else {
            setShell("opening", ["name": name, "step": Self.startingRhino])
        }
    }

    private func sendOpen() {
        // Timed from here: starting Rhino has RhinoHost's own limit, and the two must not race.
        openTimer?.invalidate()
        openTimer = Timer.scheduledTimer(withTimeInterval: Self.openTimeout, repeats: false) { [weak self] _ in
            self?.onOpenTimedOut()
        }

        setShell("opening", ["name": name, "step": Self.loadingGrasshopper])
        rhino?.send(AppHostProtocol.open, [AppHostProtocol.pathField: path, AppHostProtocol.keyField: key])
    }

    private func onRhinoMessage(_ message: [String: String]) {
        switch message[AppHostProtocol.typeField] {
        case AppHostProtocol.ready:
            rhinoReady = true
            if opening {
                sendOpen()
            }

        case AppHostProtocol.step:
            if let step = message[AppHostProtocol.stepField], opening {
                setShell("opening", ["name": name, "step": step])
            }

        case AppHostProtocol.show:
            if let text = message[AppHostProtocol.urlField], let url = URL(string: text), url.host != nil {
                showSession(url)
            }

        case AppHostProtocol.clear:
            // The definition closed from inside its page. One closed from here, or one whose
            // page already gave way to an error, has nothing on screen to clear.
            if sessionURL != nil {
                leaveDefinition()
            }

        case AppHostProtocol.error:
            endOpen()
            showError(message[AppHostProtocol.messageField] ?? "The app didn't open.", canRetry: true)

        default:
            break
        }
    }

    private func showSession(_ url: URL) {
        endOpen()
        if opensAsApp {
            isFixed = true
        }

        sessionURL = url
        shellLoaded = false
        shellNavigating = false
        if let path {
            AppSettings.rememberRecent(path)
            NSDocumentController.shared.noteNewRecentDocumentURL(URL(fileURLWithPath: path))
        }

        webView.load(URLRequest(url: url))
    }

    private func onRhinoFailed(_ message: String) {
        endOpen()
        rhino = nil
        rhinoReady = false
        showError(message, canRetry: path != nil)
    }

    /// Rhino went quiet: most likely a dialog opened where nobody can see it. That Rhino is no
    /// use any more, so the next attempt starts a new one.
    private func onOpenTimedOut() {
        endOpen()
        dropRhino()
        showError("The app took too long to start. Open the definition in Grasshopper to see what it's waiting for.",
                  canRetry: true)
    }

    private func endOpen() {
        opening = false
        stopOpenTimer()
    }

    private func stopOpenTimer() {
        openTimer?.invalidate()
        openTimer = nil
    }

    private func dropRhino() {
        rhino?.quitInBackground()
        rhino = nil
        rhinoReady = false
    }

    private func leaveDefinition() {
        if isFixed {
            window.close()
        } else {
            window.title = "Selva"
            applyAppIcon(nil)
            showLauncher()
        }
    }

    func chooseFile() {
        let panel = NSOpenPanel()
        panel.message = "Open a Selva app or a Grasshopper definition with a Selva UI"
        panel.allowedContentTypes = AppFile.openableTypes
        panel.beginSheetModal(for: window) { [weak self] response in
            if response == .OK, let url = panel.url {
                self?.open(url.path)
            }
        }
    }

    // ============================================================================
    // The app's own page
    // ============================================================================

    private func showLauncher() {
        path = nil
        let recent = AppSettings.existingRecent.map { file -> [String: String] in
            let url = URL(fileURLWithPath: file)
            return [
                "path": file,
                "name": url.deletingPathExtension().lastPathComponent,
                "folder": (url.deletingLastPathComponent().path as NSString).abbreviatingWithTildeInPath
            ]
        }
        setShell("launcher", ["recent": recent])
    }

    private func showError(_ message: String, canRetry: Bool) {
        setShell("error", ["message": message, "canRetry": canRetry])
    }

    /// The page is stateless: it draws whatever the last call here said.
    private func setShell(_ view: String, _ fields: [String: Any]) {
        shellState = fields.merging(["view": view, "fixed": isFixed]) { _, new in new }
        sessionURL = nil
        if shellLoaded {
            pushShellState()
        } else if !shellNavigating {
            // The first paint, or coming back from a session page. The page asks for its state
            // with "ready" once it has loaded.
            shellNavigating = true
            webView.loadHTMLString(Self.shellHTML, baseURL: nil)
        }
    }

    private func pushShellState() {
        guard let json = try? JSONSerialization.data(withJSONObject: shellState),
              let text = String(data: json, encoding: .utf8)
        else {
            return
        }

        webView.evaluateJavaScript("window.selvaShell(\(text))")
    }

    fileprivate func onShellMessage(_ message: WKScriptMessage) {
        // The session page comes from the plug-in's server and has no business driving the app.
        guard sessionURL == nil, message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host.isEmpty,
              let body = message.body as? [String: Any], let command = body["cmd"] as? String
        else {
            return
        }

        switch command {
        case "ready":
            shellLoaded = true
            shellNavigating = false
            pushShellState()

        case "choose":
            chooseFile()

        case "open":
            if let file = body["path"] as? String {
                open(file)
            }

        case "key":
            if let typed = body["key"] as? String, !typed.isEmpty {
                onKeyEntered(typed, remember: body["remember"] as? Bool == true)
            }

        case "retry":
            if let path {
                open(path, asApp: opensAsApp)
            }

        case "back":
            if !isFixed {
                // A definition whose page gave way to a key prompt or an error is still open
                // in Rhino.
                rhino?.send(AppHostProtocol.close)
            }

            leaveDefinition()

        default:
            break
        }
    }

    /// `Plugin/Selva.App/shell.html`, the page the Windows app shows too.
    private static let shellHTML: String = {
        guard let page = Bundle.main.url(forResource: "shell", withExtension: "html"),
              let logo = Bundle.main.url(forResource: "logo", withExtension: "svg"),
              let html = try? String(contentsOf: page, encoding: .utf8),
              let svg = try? Data(contentsOf: logo)
        else {
            fatalError("Selva.app is missing its shell page.")
        }

        return html.replacingOccurrences(of: "%LOGO%", with: "data:image/svg+xml;base64," + svg.base64EncodedString())
    }()

    // ============================================================================
    // The window
    // ============================================================================

    /// The app file's icon goes where a Mac shows a running program's: the Dock.
    private func applyAppIcon(_ png: Data?) {
        NSApp.applicationIconImage = png.flatMap { NSImage(data: $0) }
    }

    private static func openInBrowser(_ url: URL) {
        if ["http", "https", "mailto"].contains(url.scheme?.lowercased()) {
            NSWorkspace.shared.open(url)
        }
    }
}

extension AppWindowController: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        endOpen()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.shellHandler)
        webView.stopLoading()
        rhino?.quitInBackground()
        rhino = nil
    }
}

// ============================================================================
// The session page
// ============================================================================

extension AppWindowController: WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if target.scheme == Self.hostCommandScheme {
            decisionHandler(.cancel)
            if target.host == Self.openCommand {
                // Not inside the navigation callback: a sheet there stalls the web view.
                DispatchQueue.main.async { self.chooseFile() }
            }

            return
        }

        if navigationAction.targetFrame?.isMainFrame == false || target.scheme == "about" || target.scheme == "data" {
            decisionHandler(.allow)
            return
        }

        // The session page stays on the plug-in's server; anything else is a link out.
        if let session = sessionURL, let origin = Self.origin(of: session), navigationAction.targetFrame != nil {
            // A file the page made itself is a blob: URL of its own origin.
            let ownBlob = target.scheme == "blob" && target.absoluteString.hasPrefix("blob:\(origin)/")
            if ownBlob || Self.origin(of: target) == origin {
                decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
                return
            }
        }

        decisionHandler(.cancel)
        Self.openInBrowser(target)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        let download = !navigationResponse.canShowMIMEType || disposition.hasPrefix("attachment")
        decisionHandler(download ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// A file the app produced is saved where the user says, as in any desktop program.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { [self] result in
            guard result == .OK, let destination = panel.url else {
                completionHandler(nil)
                return
            }

            // Written beside the destination and moved over it once complete: WebKit refuses a
            // path that exists, and a download that fails must not cost the file it replaces.
            do {
                let folder = try FileManager.default.url(for: .itemReplacementDirectory, in: .userDomainMask,
                                                         appropriateFor: destination, create: true)
                let written = folder.appendingPathComponent(destination.lastPathComponent)
                downloads[ObjectIdentifier(download)] = (written, destination)
                completionHandler(written)
            } catch {
                completionHandler(nil)
                showSaveFailed(destination, error)
            }
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let saved = downloads.removeValue(forKey: ObjectIdentifier(download)) else {
            return
        }

        defer { try? FileManager.default.removeItem(at: saved.written.deletingLastPathComponent()) }
        do {
            if FileManager.default.fileExists(atPath: saved.destination.path) {
                _ = try FileManager.default.replaceItemAt(saved.destination, withItemAt: saved.written)
            } else {
                try FileManager.default.moveItem(at: saved.written, to: saved.destination)
            }
        } catch {
            showSaveFailed(saved.destination, error)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let saved = downloads.removeValue(forKey: ObjectIdentifier(download)) else {
            return
        }

        try? FileManager.default.removeItem(at: saved.written.deletingLastPathComponent())
        if (error as? URLError)?.code != .cancelled {
            showSaveFailed(saved.destination, error)
        }
    }

    private func showSaveFailed(_ destination: URL, _ error: Error) {
        guard window.isVisible else {
            return
        }

        let alert = NSAlert()
        alert.messageText = "\(destination.lastPathComponent) wasn't saved."
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let target = navigationAction.request.url {
            Self.openInBrowser(target)
        }

        return nil
    }

    /// WebKit shows no panel of its own for a file input.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    private static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme, let host = url.host, let port = url.port else {
            return nil
        }

        return "\(scheme)://\(host):\(port)"
    }
}

/// The user content controller keeps its handler alive, and the window owns the controller.
private final class ShellMessages: NSObject, WKScriptMessageHandler {
    private weak var owner: AppWindowController?

    init(_ owner: AppWindowController) {
        self.owner = owner
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.onShellMessage(message)
    }
}

/// No Reload, Back or Inspect Element: the page is an app, not a browser tab.
private final class PlainWebView: WKWebView {
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        menu.removeAllItems()
    }
}
