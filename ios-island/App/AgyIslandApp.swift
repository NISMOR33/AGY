import SwiftUI
import ActivityKit

@main
struct AgyIslandApp: App {
    @StateObject private var liveActivityManager = LiveActivityManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(liveActivityManager)
        }
    }
}

// MARK: - Manager pour piloter la Live Activity et le Dynamic Island
@MainActor
final class LiveActivityManager: ObservableObject {
    static let shared = LiveActivityManager()

    @Published var currentActivity: Activity<AgyIslandAttributes>?
    @Published var isConnected: Bool = false
    @Published var serverUrl: String = UserDefaults.standard.string(forKey: "agy_server_url") ?? ""
    @Published var authToken: String = UserDefaults.standard.string(forKey: "agy_auth_token") ?? ""
    @Published var log: [String] = []

    private var eventSourceTask: URLSessionDataTask?
    private var timer: Timer?
    private var startTimestamp: Date?

    init() {
        // Nettoyer les activités orphelines éventuelles
        for act in Activity<AgyIslandAttributes>.activities {
            self.currentActivity = act
            break
        }
    }

    func saveConfig(url: String, token: String) {
        self.serverUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
        self.authToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(self.serverUrl, forKey: "agy_server_url")
        UserDefaults.standard.set(self.authToken, forKey: "agy_auth_token")
    }

    // Déclencher manuellement ou via SSE l'îlot
    func startDynamicIsland(projectName: String = "agy-console") {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            addLog("⚠️ Live Activities désactivées dans les réglages iOS.")
            return
        }

        stopDynamicIsland()

        let initialAttributes = AgyIslandAttributes(title: "agy console")
        let initialState = AgyIslandAttributes.ContentState(
            isBusy: true,
            projectName: projectName,
            statusText: "agy réfléchit…",
            activeTool: nil,
            elapsedTime: "00:00",
            isSuccess: false
        )

        do {
            let activity = try Activity<AgyIslandAttributes>.request(
                attributes: initialAttributes,
                content: .init(state: initialState, staleDate: nil),
                pushType: nil
            )
            self.currentActivity = activity
            self.startTimestamp = Date()
            startStopwatch()
            addLog("✅ Îlot Dynamique activé !")
        } catch {
            addLog("❌ Erreur lancement Activity: \(error.localizedDescription)")
        }
    }

    func updateDynamicIsland(
        isBusy: Bool,
        projectName: String,
        statusText: String,
        activeTool: String? = nil,
        isSuccess: Bool = false
    ) {
        guard let activity = currentActivity else { return }

        let elapsed = formatElapsed()
        let updatedState = AgyIslandAttributes.ContentState(
            isBusy: isBusy,
            projectName: projectName,
            statusText: statusText,
            activeTool: activeTool,
            elapsedTime: elapsed,
            isSuccess: isSuccess
        )

        Task {
            await activity.update(.init(state: updatedState, staleDate: nil))
        }
    }

    func stopDynamicIsland() {
        timer?.invalidate()
        timer = nil
        guard let activity = currentActivity else { return }
        Task {
            let finalState = AgyIslandAttributes.ContentState(
                isBusy: false,
                projectName: "agy",
                statusText: "Terminé",
                elapsedTime: formatElapsed(),
                isSuccess: true
            )
            await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .after(.now + 4))
            self.currentActivity = nil
        }
    }

    private func startStopwatch() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self, let act = self.currentActivity else { return }
            var st = act.content.state
            st.elapsedTime = self.formatElapsed()
            Task {
                await act.update(.init(state: st, staleDate: nil))
            }
        }
    }

    private func formatElapsed() -> String {
        guard let start = startTimestamp else { return "00:00" }
        let total = Int(Date().timeIntervalSince(start))
        let m = total / 60
        let s = total % 60
        return String(format: "%02d:%02d", m, s)
    }

    func addLog(_ msg: String) {
        log.append("[\(Date().formatted(date: .omitted, time: .standard))] \(msg)")
    }
}

// MARK: - Interface de configuration principale
struct ContentView: View {
    @EnvironmentObject var manager: LiveActivityManager
    @State private var urlInput: String = ""
    @State private var tokenInput: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Serveur agy-console")) {
                    TextField("https://...trycloudflare.com", text: $urlInput)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)
                    
                    SecureField("Token d'accès (optionnel)", text: $tokenInput)
                    
                    Button("Sauvegarder l'adresse") {
                        manager.saveConfig(url: urlInput, token: tokenInput)
                        manager.addLog("Configuration enregistrée.")
                    }
                }
                
                Section(header: Text("Contrôle Live Activity & Dynamic Island")) {
                    Button(action: {
                        manager.startDynamicIsland(projectName: "Projet Actif")
                    }) {
                        HStack {
                            Image(systemName: "sparkles")
                                .foregroundColor(.orange)
                            Text("Démarrer l'Îlot Dynamique (Test)")
                                .fontWeight(.semibold)
                        }
                    }

                    Button(action: {
                        manager.updateDynamicIsland(
                            isBusy: true,
                            projectName: "Mon Projet",
                            statusText: "Lecture de fichier...",
                            activeTool: "read_file"
                        )
                    }) {
                        Text("Simuler Action Outil (Tool Call)")
                    }

                    Button(action: {
                        manager.updateDynamicIsland(
                            isBusy: false,
                            projectName: "Mon Projet",
                            statusText: "Tâche terminée",
                            isSuccess: true
                        )
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            manager.stopDynamicIsland()
                        }
                    }) {
                        Text("Simuler Fin de Tâche (Succès)")
                            .foregroundColor(.green)
                    }

                    Button(role: .destructive, action: {
                        manager.stopDynamicIsland()
                    }) {
                        Text("Arrêter l'Îlot")
                    }
                }
                
                Section(header: Text("Statut")) {
                    ForEach(manager.log.suffix(6), id: \.self) { line in
                        Text(line)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.gray)
                    }
                }
            }
            .navigationTitle("agy Island")
            .onAppear {
                urlInput = manager.serverUrl
                tokenInput = manager.authToken
            }
        }
    }
}
