import WidgetKit
import SwiftUI
import ActivityKit

@main
struct AgyIslandWidgetBundle: WidgetBundle {
    var body: some Widget {
        AgyIslandLiveActivityWidget()
    }
}

struct AgyIslandLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgyIslandAttributes.self) { context in
            // MARK: - Bannière Écran Verrouillé (Lock Screen Live Activity)
            LockScreenLiveActivityView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.85))
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            // MARK: - Dynamic Island (iPhone 14 Pro, 15, 15 Pro, 16, 16 Pro)
            DynamicIsland {
                // Vue Élargie (Appui long sur l'Îlot)
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        AgyMascot(
                            color: context.state.isSuccess ? .green : .orange,
                            working: context.state.isBusy
                        )
                            .frame(width: 22, height: 20)
                        Text(context.state.projectName)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                            .lineLimit(1)
                    }
                    .padding(.leading, 8)
                }
                
                DynamicIslandExpandedRegion(.trailing) {
                    LiveElapsedTime(state: context.state)
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(context.state.isBusy ? Color.orange : Color.gray)
                        .padding(.trailing, 8)
                }
                
                DynamicIslandExpandedRegion(.center) {
                    HStack(spacing: 8) {
                        if context.state.isBusy {
                            Circle()
                                .fill(Color.orange)
                                .frame(width: 8, height: 8)
                        }
                        Text(context.state.activeTool != nil ? context.state.activeTool! : context.state.statusText)
                            .font(.system(size: 13, weight: .regular))
                            .foregroundColor(.white.opacity(0.9))
                            .lineLimit(1)
                    }
                }
                
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .top, spacing: 8) {
                        if context.state.isBusy {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .orange))
                                .scaleEffect(0.7)
                            VStack(alignment: .leading, spacing: 3) {
                                if let file = context.state.activeFile, !file.isEmpty {
                                    Label(file, systemImage: "doc.text.fill")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundColor(.white)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                } else {
                                    Text("AGY analyse le projet…")
                                        .font(.system(size: 12))
                                        .foregroundColor(.white.opacity(0.75))
                                }
                                Text("\(context.state.actionCount) action\(context.state.actionCount > 1 ? "s" : "") · suivi en direct")
                                    .font(.system(size: 10))
                                    .foregroundColor(.white.opacity(0.5))
                            }
                        } else if context.state.isSuccess {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Tâche terminée avec succès")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.white.opacity(0.9))
                        } else {
                            Text("En veille")
                                .font(.system(size: 12))
                                .foregroundColor(.white.opacity(0.5))
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 10)
                    .padding(.top, 4)
                }
            } compactLeading: {
                // Vue Compacte Gauche (Pilule standard)
                HStack(spacing: 4) {
                    AgyMascot(
                        color: context.state.isSuccess ? .green : .orange,
                        working: context.state.isBusy
                    )
                        .frame(width: 18, height: 16)
                }
                .padding(.leading, 4)
            } compactTrailing: {
                // Vue Compacte Droite
                Group {
                    if context.state.isBusy { LiveElapsedTime(state: context.state) }
                    else { Text("AGY") }
                }
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(context.state.isBusy ? Color.orange : Color.white.opacity(0.8))
                    .padding(.trailing, 4)
            } minimal: {
                // Vue Minimale (quand une autre app partage l'îlot)
                AgyMascot(
                    color: context.state.isSuccess ? .green : .orange,
                    working: context.state.isBusy
                )
                    .frame(width: 16, height: 14)
            }
        }
    }
}

// MARK: - Vue Écran Verrouillé (Live Activity Lock Screen)
struct LockScreenLiveActivityView: View {
    let state: AgyIslandAttributes.ContentState
    
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(state.isBusy ? Color.orange.opacity(0.2) : (state.isSuccess ? Color.green.opacity(0.2) : Color.white.opacity(0.1)))
                    .frame(width: 44, height: 44)
                
                AgyMascot(
                    color: state.isSuccess ? .green : .orange,
                    working: state.isBusy
                )
                    .frame(width: 30, height: 27)
            }
            
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(state.projectName)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    LiveElapsedTime(state: state)
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(state.isBusy ? .orange : .gray)
                }
                
                Text(activityDescription)
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.8))
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private var activityDescription: String {
        if let file = state.activeFile, !file.isEmpty {
            return "\(state.activeTool ?? "Action") · \(file)"
        }
        return state.activeTool != nil ? "Exécution de \(state.activeTool!)" : state.statusText
    }
}

struct LiveElapsedTime: View {
    let state: AgyIslandAttributes.ContentState
    var body: some View {
        if state.isBusy, let start = state.startedAt {
            Text(timerInterval: start...Date.distantFuture, countsDown: false)
                .monospacedDigit()
        } else {
            Text(state.elapsedTime)
        }
    }
}
