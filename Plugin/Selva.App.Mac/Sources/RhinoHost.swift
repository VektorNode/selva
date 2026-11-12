import AppKit
import Darwin

/// The Rhino this app runs definitions in: a normal Rhino started hidden, reached over a Unix
/// socket once Selva's panel plug-in in it has connected. The callbacks run on the main thread.
///
/// There is one at a time. Rhino for Mac refuses to run beside another Rhino: the second one
/// stops at an alert about the first, which nobody would see here.
final class RhinoHost {
    // A cold Rhino on a slow disk: start, then load the panel plug-in and connect.
    private static let startTimeout: TimeInterval = 120
    private static let quitTimeout: TimeInterval = 8

    /// A message from Rhino, as `AppHostProtocol` describes.
    var onMessage: (([String: String]) -> Void)?

    /// Rhino couldn't be started, or went away. The message is for the user. Called once.
    var onFailed: ((String) -> Void)?

    private let state = NSLock()
    private let writing = NSLock()
    private let starting = DispatchGroup()
    private var connection: Int32 = -1
    private var rhino: pid_t = 0
    private var quitting = false
    private var failed = false

    deinit {
        if connection >= 0 {
            close(connection)
        }
    }

    /// Returns at once; `AppHostProtocol.ready` arrives when Rhino is up.
    func start() {
        let installs = RhinoInstalls.find()
        starting.enter()
        Thread.detachNewThread { [self] in
            run(installs)
            starting.leave()
        }
    }

    func send(_ type: String, _ fields: [String: String?] = [:]) {
        var message = [AppHostProtocol.typeField: type]
        for (field, value) in fields {
            message[field] = value
        }

        guard var line = try? JSONSerialization.data(withJSONObject: message, options: .withoutEscapingSlashes) else {
            return
        }

        line.append(0x0A)
        writing.lock()
        defer { writing.unlock() }
        let connection = locked { self.connection }
        guard connection >= 0 else {
            return
        }

        let sent = line.withUnsafeBytes { bytes -> Bool in
            var offset = 0
            while offset < bytes.count {
                let count = write(connection, bytes.baseAddress! + offset, bytes.count - offset)
                if count < 0 && errno == EINTR {
                    continue
                }

                if count <= 0 {
                    return false
                }

                offset += count
            }

            return true
        }
        if !sent {
            fail("Rhino closed unexpectedly.")
        }
    }

    /// Asks Rhino to exit and makes sure it has: a Rhino nobody can see would keep its licence
    /// and its memory. Blocks until a start under way has ended and then for up to
    /// `quitTimeout`, so not for the main thread.
    func quit() {
        locked { quitting = true }

        // First, or a Rhino that macOS is still launching is missed. The start sees `quitting`
        // as soon as it knows that Rhino's pid, stops it and removes its socket file.
        starting.wait()
        send(AppHostProtocol.quit)

        let (rhino, connection) = locked { (self.rhino, self.connection) }
        if rhino > 0 {
            var exited = false
            let deadline = Date().addingTimeInterval(Self.quitTimeout)
            while connection >= 0 && !exited && Date() < deadline {
                exited = !Self.isRunning(rhino)
                if !exited {
                    usleep(100_000)
                }
            }

            if !exited {
                Self.forceStop(rhino)
            }
        }

        if connection >= 0 {
            // Ends the reader's blocked read, should Rhino have left the socket open.
            shutdown(connection, SHUT_RDWR)
        }
    }

    /// Rhinos that were told to exit and may not have yet. The app waits for them before it
    /// terminates.
    static let leaving = DispatchGroup()

    func quitInBackground() {
        DispatchQueue.global().async(group: Self.leaving) { self.quit() }
    }

    private func run(_ installs: [RhinoInstall]) {
        if installs.isEmpty {
            fail("Rhino isn't installed on this computer. Selva needs Rhino 8 or Rhino 9.")
            return
        }

        // The Rhino of an earlier attempt may still be on its way out. Polled: this host's own
        // quit is one of `leaving` and waits for this thread.
        while Self.leaving.wait(timeout: .now() + .milliseconds(250)) == .timedOut {
            if locked({ quitting }) {
                return
            }
        }

        if Self.isRhinoRunning {
            fail("Rhino is already open, and a Mac runs one Rhino at a time. Quit Rhino, then try again.")
            return
        }

        // A Rhino without Selva never connects: starting it would only spend the timeout and a licence.
        let usable = installs.filter(\.hasSelva)
        if usable.isEmpty {
            fail("Selva isn't installed in Rhino. Install it from Rhino's package manager "
                + "(type PackageManager in Rhino), then try again.")
            return
        }

        for install in usable {
            if locked({ quitting }) {
                return
            }

            if tryStart(install.appURL) {
                return
            }
        }

        fail("Rhino didn't start. Open Rhino once to check that it runs and has a licence, then try again.")
    }

    private func tryStart(_ appURL: URL) -> Bool {
        guard let (listener, path) = Self.openSocket() else {
            return false
        }

        // One Rhino connects, once. The connection outlives both the listener and its path.
        defer {
            close(listener)
            unlink(path)
        }

        // Hidden and never activated is what keeps Rhino's windows, and with them every panel
        // and the Grasshopper editor, off screen. A new instance: a Rhino the user already has
        // open would take the command line otherwise.
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.arguments = ["-nosplash", "-runscript=_-\(AppHostProtocol.command) \(path)"]
        configuration.hides = true
        configuration.activates = false
        configuration.addsToRecentItems = false
        configuration.createsNewApplicationInstance = true

        let launched = DispatchSemaphore(value: 0)
        var started: pid_t = 0
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { application, _ in
            started = application?.processIdentifier ?? 0
            launched.signal()
        }
        launched.wait()
        guard started > 0 else {
            return false
        }

        locked { rhino = started }
        let deadline = Date().addingTimeInterval(Self.startTimeout)
        var waiting = pollfd(fd: listener, events: Int16(POLLIN), revents: 0)
        while poll(&waiting, 1, 250) <= 0 {
            if locked({ quitting }) || !Self.isRunning(started) || Date() > deadline {
                // Still running means it may be sitting on a dialog nobody can see.
                Self.forceStop(started)
                locked { rhino = 0 }
                return false
            }
        }

        let accepted = accept(listener, nil, nil)
        guard accepted >= 0 else {
            Self.forceStop(started)
            locked { rhino = 0 }
            return false
        }

        // A write to a Rhino that has gone must fail, not end this app with SIGPIPE.
        var on: Int32 = 1
        setsockopt(accepted, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        locked { connection = accepted }
        Thread.detachNewThread { [self] in readLoop(accepted) }
        return true
    }

    private func readLoop(_ connection: Int32) {
        var pending = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = read(connection, &buffer, buffer.count)
            if count < 0 && errno == EINTR {
                continue
            }

            if count <= 0 {
                break
            }

            pending.append(buffer, count: count)
            while let newline = pending.firstIndex(of: 0x0A) {
                dispatch(pending.subdata(in: pending.startIndex..<newline))
                pending.removeSubrange(pending.startIndex...newline)
            }
        }

        fail("Rhino closed unexpectedly.")
    }

    private func dispatch(_ line: Data) {
        guard let raw = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
            return
        }

        let message = raw.compactMapValues { $0 as? String }
        DispatchQueue.main.async { self.onMessage?(message) }
    }

    private func fail(_ message: String) {
        let first = locked { () -> Bool in
            if quitting || failed {
                return false
            }

            failed = true
            return true
        }
        if first {
            DispatchQueue.main.async { self.onFailed?(message) }
        }
    }

    private func locked<T>(_ body: () -> T) -> T {
        state.lock()
        defer { state.unlock() }
        return body()
    }

    /// A socket in the user's own temporary folder, so only this user can connect: a protected
    /// app's key travels over it.
    private static func openSocket() -> (Int32, String)? {
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).lowercased()
        let path = (NSTemporaryDirectory() as NSString).appendingPathComponent("selva-app-\(id).sock")
        var address = sockaddr_un()

        // The path is one token on Rhino's command line, and sun_path is a fixed buffer.
        guard !path.contains(" "), path.utf8.count < MemoryLayout.size(ofValue: address.sun_path) else {
            return nil
        }

        let listener = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else {
            return nil
        }

        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: path.utf8) }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0, chmod(path, 0o600) == 0, listen(listener, 1) == 0 else {
            close(listener)
            unlink(path)
            return nil
        }

        return (listener, path)
    }

    /// Any Rhino version: their bundle identifiers end in the major version.
    private static var isRhinoRunning: Bool {
        let prefix = "com.mcneel.rhinoceros."
        return NSWorkspace.shared.runningApplications.contains { application in
            guard let id = application.bundleIdentifier, id.hasPrefix(prefix),
                  id.dropFirst(prefix.count).allSatisfy(\.isNumber)
            else {
                return false
            }

            // The list is refreshed on the main run loop; a Rhino that just exited may still be in it.
            return isRunning(application.processIdentifier)
        }
    }

    private static func isRunning(_ pid: pid_t) -> Bool {
        kill(pid, 0) == 0 || errno == EPERM
    }

    /// SIGKILL, and Rhino's crash monitor first: the monitor outlives a killed Rhino. Not
    /// SIGTERM, which Rhino turns into an abort, a crash report and a dialog about it.
    private static func forceStop(_ pid: pid_t) {
        guard isRunning(pid) else {
            return
        }

        var children = [pid_t](repeating: 0, count: 64)
        _ = proc_listchildpids(pid, &children, Int32(children.count * MemoryLayout<pid_t>.size))
        for child in children where child > 0 {
            var name = [CChar](repeating: 0, count: 64)
            proc_name(child, &name, UInt32(name.count))
            if String(cString: name) == "RhinoMonitor" {
                kill(child, SIGKILL)
            }
        }

        kill(pid, SIGKILL)
    }
}
