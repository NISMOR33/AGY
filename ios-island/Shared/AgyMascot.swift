import SwiftUI

/// Native reproduction of the orange pixel mascot used by `MAS()` in the web UI.
public struct AgyMascot: View {
    public var color: Color
    public var working: Bool

    public init(color: Color = .orange, working: Bool = false) {
        self.color = color
        self.working = working
    }

    public var body: some View {
        Canvas { context, size in
            let unit = min(size.width / 16, size.height / 14)
            let xOffset = (size.width - unit * 16) / 2
            let yOffset = (size.height - unit * 14) / 2
            func rect(_ x: Int, _ y: Int, _ width: Int, _ height: Int, _ fill: Color) {
                let frame = CGRect(x: xOffset + CGFloat(x) * unit,
                                   y: yOffset + CGFloat(y) * unit,
                                   width: CGFloat(width) * unit,
                                   height: CGFloat(height) * unit)
                context.fill(Path(frame), with: .color(fill))
            }
            rect(3, 0, 2, 2, color)
            rect(11, 0, 2, 2, color)
            rect(2, 2, 12, 8, color)
            rect(0, 5, 2, 3, color)
            rect(14, 5, 2, 3, color)
            rect(4, 10, 2, 3, color)
            rect(10, 10, 2, 3, color)
            rect(5, 4, 2, 3, .black)
            rect(9, 4, 2, 3, .black)
        }
        .offset(y: working ? -1 : 0)
        .animation(working ? .easeInOut(duration: 0.42).repeatForever(autoreverses: true) : .default,
                   value: working)
        .accessibilityLabel("Mascotte AGY")
    }
}
