import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct AgyWebView: UIViewRepresentable {
    @EnvironmentObject var session: AgySession
    @EnvironmentObject var activity: LiveActivityManager
    let baseURL: URL
    let token: String

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "agyNative")
        controller.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 11.0 / 255.0, green: 12.0 / 255.0, blue: 14.0 / 255.0, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        context.coordinator.load(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static let bridgeScript = #"""
    (() => {
      document.documentElement.classList.add('agy-native-ios');
      const style = document.createElement('style');
      style.textContent = `
        html, body { min-height: 100%; background: #0b0c0e !important; }
        body { padding-top: env(safe-area-inset-top, 0px) !important; }
        #mn { padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px)) !important; }
      `;
      document.documentElement.appendChild(style);
    })();
    """#

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIDocumentPickerDelegate {
        let parent: AgyWebView
        init(_ parent: AgyWebView) { self.parent = parent }

        func load(in webView: WKWebView) {
            var components = URLComponents(url: parent.baseURL, resolvingAgainstBaseURL: false)!
            components.path = "/"
            components.queryItems = [URLQueryItem(name: "k", value: parent.token), URLQueryItem(name: "app", value: "ios")]
            var request = URLRequest(url: components.url!)
            request.setValue(parent.token, forHTTPHeaderField: "x-agy-token")
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.setValue("no-cache, no-store, must-revalidate", forHTTPHeaderField: "Cache-Control")
            webView.load(request)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let object = message.body as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: object),
                  let event = try? JSONDecoder().decode(AgyBridgeEvent.self, from: data) else { return }
            Task { @MainActor in parent.activity.handle(event: event) }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in parent.session.errorMessage = error.localizedDescription; parent.session.isConnected = false }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in
                parent.activity.handle(event: AgyBridgeEvent(type: "app_ready", project: "AGY", tool: nil, success: nil))
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url,
               let host = url.host, host != parent.baseURL.host,
               navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else { decisionHandler(.allow) }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url { webView.load(URLRequest(url: url)) }
            return nil
        }
    }
}
