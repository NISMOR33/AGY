import SwiftUI
import ActivityKit

// MARK: - ActivityAttributes Partagés entre l'App et le Widget
public struct AgyIslandAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var isBusy: Bool
        public var projectName: String
        public var statusText: String
        public var activeTool: String?
        public var elapsedTime: String
        public var isSuccess: Bool
        
        public init(
            isBusy: Bool,
            projectName: String,
            statusText: String,
            activeTool: String? = nil,
            elapsedTime: String = "00:00",
            isSuccess: Bool = false
        ) {
            self.isBusy = isBusy
            self.projectName = projectName
            self.statusText = statusText
            self.activeTool = activeTool
            self.elapsedTime = elapsedTime
            self.isSuccess = isSuccess
        }
    }

    public var title: String
    
    public init(title: String = "agy console") {
        self.title = title
    }
}
