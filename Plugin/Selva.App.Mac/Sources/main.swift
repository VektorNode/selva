import AppKit

// Selva                      the launcher
// Selva <file>               that app file or definition, as its own window
// Selva --add-key <key>      stores a protected app's key, so this user is never asked for it
//
// Finder opens files through the app delegate, not the command line.
let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.first == "--add-key" {
    guard arguments.count == 2, !arguments[1].isEmpty else {
        exit(1)
    }

    exit(KeyStore.write(keyId: AppFileKey.idOf(arguments[1]), key: arguments[1]) ? 0 : 1)
}

let delegate = AppDelegate()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
