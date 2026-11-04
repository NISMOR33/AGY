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
      const NativeEventSource = window.EventSource;
      window.EventSource = function(url, config) {
        const source = new NativeEventSource(url, config);
        if (String(url).includes('/api/chat/stream')) {
          source.addEventListener('message', event => {
            try {
              const payload = JSON.parse(event.data);
              const params = new URL(String(url), location.href).searchParams;
              const out = { type: payload.type, project: params.get('p') || 'AGY' };
              if (payload.type === 'tool') out.tool = payload.tool?.name || payload.tool?.tool || payload.tool?.command || 'outil';
              if (payload.type === 'turn_end') out.success = !payload.assistantMsg?.error;
              window.webkit.messageHandlers.agyNative.postMessage(out);
            } catch (_) {}
          });
        }
        return source;
      };
      window.EventSource.prototype = NativeEventSource.prototype;
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
