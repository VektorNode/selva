/// The names of the protocol between this app and Rhino. Its specification is the header of
/// `Plugin/Selva.App/AppHostProtocol.cs`; a name changed there changes here.
enum AppHostProtocol {
    /// The Rhino command that takes the socket's path.
    static let command = "SelvaAppHost"

    static let typeField = "type"

    static let ready = "ready"
    static let step = "step"
    static let show = "show"
    static let clear = "clear"
    static let error = "error"

    static let open = "open"
    static let close = "close"
    static let quit = "quit"

    static let stepField = "step"
    static let urlField = "url"
    static let messageField = "message"
    static let pathField = "path"
    static let keyField = "key"
}
