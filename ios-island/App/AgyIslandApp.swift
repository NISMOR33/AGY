import SwiftUI
import ActivityKit
import Security

@main
struct AgyIslandApp: App {
    @StateObject private var session = AgySession()
    @StateObject private var activity = LiveActivityManager()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(activity)
        }
    }
}

@MainActor
final class AgySession: ObservableObject {
    @Published var serverURL = UserDefaults.standard.string(forKey: "agy_server_url") ?? ""
    @Published var token = KeychainStore.read("agy_access_token") ?? ""
    @Published var isConnected = false
    @Published var isChecking = false
    @Published var errorMessage: String?

    var normalizedURL: URL? {
        var value = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") { value.removeLast() }
        guard var components = URLComponents(string: value),
              components.scheme == "https" || components.scheme == "http",
              components.host != nil else { return nil }
        components.query = nil
        components.fragment = nil
        return components.url
    }

    func connect() async {
        guard let baseURL = normalizedURL else {
            errorMessage = "Adresse invalide. Utilise https://… ou http://…"
            return
        }
        isChecking = true
        errorMessage = nil
        defer { isChecking = false }
        do {
            var request = URLRequest(url: baseURL.appendingPathComponent("api/auth"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(AuthRequest(token: token))
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AgyError.invalidResponse }
            if http.statusCode == 200 {
                _ = try JSONDecoder().decode(AuthResponse.self, from: data)
                // Keep the access code entered by the user. The server's `token`
                // response is an internal console identifier, not necessarily AGY_PIN.
                UserDefaults.standard.set(baseURL.absoluteString, forKey: "agy_server_url")
                KeychainStore.save(token, key: "agy_access_token")
                serverURL = baseURL.absoluteString
                isConnected = true
            } else {
                let result = try? JSONDecoder().decode(AuthResponse.self, from: data)
                throw AgyError.server(result?.error ?? "Connexion refusée (HTTP \(http.statusCode)).")
            }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            isConnected = false
        }
    }

    func disconnect() {
        isConnected = false
        token = ""
        KeychainStore.delete("agy_access_token")
        HTTPCookieStorage.shared.removeCookies(since: .distantPast)
    }
}

private struct AuthRequest: Encodable { let token: String }
private struct AuthResponse: Decodable { let ok: Int?; let token: String?; let error: String? }
private enum AgyError: LocalizedError {
    case invalidResponse, server(String)
    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Réponse du serveur invalide."
        case .server(let message): return message
        }
    }
}

enum KeychainStore {
    static func save(_ value: String, key: String) {
        delete(key)
        let data = Data(value.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: "com.agy.island",
                                    kSecAttrAccount as String: key,
                                    kSecValueData as String: data]
        SecItemAdd(query as CFDictionary, nil)
    }
    static func read(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: "com.agy.island",
                                    kSecAttrAccount as String: key,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func delete(_ key: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: "com.agy.island",
                                    kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
    }
}

struct RootView: View {
    @EnvironmentObject var session: AgySession
    var body: some View {
        Group {
            if session.isConnected, let url = session.normalizedURL {
                AgyWebView(baseURL: url, token: session.token)
            } else {
                LoginView()
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct LoginView: View {
    @EnvironmentObject var session: AgySession
    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            AgyMascot()
                .frame(width: 96, height: 84)
                .padding(18)
                .background(Color.black, in: RoundedRectangle(cornerRadius: 26))
            VStack(spacing: 6) {
                Text("AGY").font(.largeTitle.bold())
                Text("Connecte l’app à ta console AGY").foregroundStyle(.secondary)
            }
            VStack(spacing: 14) {
                TextField("https://…trycloudflare.com", text: $session.serverURL)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL).textContentType(.URL)
                    .padding().background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                SecureField("Code d’accès AGY", text: $session.token)
                    .textContentType(.password)
                    .padding().background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                if let error = session.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading)
                }
                Button {
                    Task { await session.connect() }
                } label: {
                    HStack {
                        if session.isChecking { ProgressView().tint(.black) }
                        Text(session.isChecking ? "Connexion…" : "Se connecter").bold()
                    }.frame(maxWidth: .infinity).padding()
                }
                .buttonStyle(.borderedProminent).tint(.orange).foregroundStyle(.black)
                .disabled(session.isChecking || session.serverURL.isEmpty)
            }
            Spacer()
            Text("Le serveur web reste utilisable en parallèle.").font(.caption).foregroundStyle(.secondary)
        }.padding(24)
    }
}

@MainActor
final class LiveActivityManager: ObservableObject {
    private var activity: Activity<AgyIslandAttributes>?
    private var startedAt: Date?

    init() { activity = Activity<AgyIslandAttributes>.activities.first }

    func handle(event: AgyBridgeEvent) {
        switch event.type {
        case "turn_start": start(project: event.project ?? "AGY")
        case "tool": update(project: event.project ?? "AGY", status: "Outil en cours", tool: event.tool)
        case "delta": update(project: event.project ?? "AGY", status: "AGY répond…", tool: nil)
        case "turn_end": finish(project: event.project ?? "AGY", success: event.success ?? true)
        default: break
        }
    }

    private func state(project: String, status: String, tool: String? = nil, busy: Bool, success: Bool = false) -> AgyIslandAttributes.ContentState {
        let seconds = Int(Date().timeIntervalSince(startedAt ?? Date()))
        return .init(isBusy: busy, projectName: project, statusText: status, activeTool: tool,
                     elapsedTime: String(format: "%02d:%02d", seconds / 60, seconds % 60), isSuccess: success)
    }
    private func start(project: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        startedAt = Date()
        if let activity { Task { await activity.end(nil, dismissalPolicy: .immediate) } }
        do {
            activity = try Activity.request(attributes: AgyIslandAttributes(title: "AGY"),
                                            content: .init(state: state(project: project, status: "AGY réfléchit…", busy: true), staleDate: nil),
                                            pushType: nil)
        } catch { print("Live Activity: \(error)") }
    }
    private func update(project: String, status: String, tool: String?) {
        guard let activity else { return }
        let next = state(project: project, status: status, tool: tool, busy: true)
        Task { await activity.update(.init(state: next, staleDate: nil)) }
    }
    private func finish(project: String, success: Bool) {
        guard let activity else { return }
        let final = state(project: project, status: success ? "Tâche terminée" : "Tâche interrompue", busy: false, success: success)
        Task {
            await activity.end(.init(state: final, staleDate: nil), dismissalPolicy: .after(.now + 8))
            self.activity = nil
        }
    }
}

struct AgyBridgeEvent: Decodable {
    let type: String
    let project: String?
    let tool: String?
    let success: Bool?
}
