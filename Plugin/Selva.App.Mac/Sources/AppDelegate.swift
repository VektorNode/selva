import AppKit

/// One window: the launcher, or the file the app was opened with. One, because a Mac runs one
/// Rhino at a time and a Rhino plays one definition at a time.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: AppWindowController?

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = makeMenu()
    }

    /// Finder sends the files here, before `applicationDidFinishLaunching` when they start the app.
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let path = urls.first(where: \.isFileURL)?.path else {
            return
        }

        if let controller {
            controller.openAsApp(path)
            controller.window.makeKeyAndOrderFront(nil)
        } else {
            controller = AppWindowController(startPath: path)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if controller == nil {
            controller = AppWindowController(startPath: Self.fileArgument)
        }

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    /// A Rhino nobody can see must not outlive the app: it gets its time to exit.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        controller?.window.close()
        RhinoHost.leaving.notify(queue: .main) {
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    /// `Selva <file>` from a terminal: the same as opening the file from Finder.
    private static var fileArgument: String? {
        let arguments = CommandLine.arguments.dropFirst()
        return arguments.first.flatMap { $0.hasPrefix("-") ? nil : $0 }
    }

    @objc private func openFile(_ sender: Any?) {
        controller?.chooseFile()
    }

    // Without an Edit menu the web view gets no Cut, Copy, Paste or Undo shortcuts.
    private func makeMenu() -> NSMenu {
        let main = NSMenu()

        let app = NSMenu()
        app.addItem(withTitle: "About Selva", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Selva", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit Selva", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu(app, title: "Selva"))

        let file = NSMenu(title: "File")
        file.addItem(withTitle: "Open…", action: #selector(openFile(_:)), keyEquivalent: "o").target = self
        file.addItem(.separator())
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(submenu(file, title: "File"))

        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(submenu(edit, title: "Edit"))

        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        main.addItem(submenu(window, title: "Window"))
        NSApp.windowsMenu = window

        return main
    }

    private func submenu(_ menu: NSMenu, title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }
}
