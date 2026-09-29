import { Component, type ReactNode } from "react";
import { t } from "@/i18n";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ padding: 24, maxWidth: 640, margin: "10vh auto", fontFamily: "var(--font-sans)" }}>
          <h2>{t("ui.error")}</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.8 }}>{this.state.error.message}</pre>
          <button type="button" onClick={() => location.reload()}>
            {t("ui.reload")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
