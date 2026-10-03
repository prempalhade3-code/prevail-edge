import { Component, type ReactNode } from "react";

/** Swallow a single failed GLB so the rest of the city still renders. */
export class ModelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
