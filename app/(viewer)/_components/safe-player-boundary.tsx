"use client";

import React, { Component, type ReactNode } from "react";
import Link from "next/link";

type Props = {
  children: ReactNode;
  backHref?: string;
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class SafePlayerBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("SafePlayerBoundary caught error:", error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="v-player-msg" role="alert" style={{ zIndex: 30 }}>
          <strong>Playback issue detected</strong>
          <p className="v-muted">
            {this.state.error?.message || "The media player encountered an unexpected issue while initializing."}
          </p>
          <div style={{ display: "flex", gap: ".75rem", marginTop: ".75rem" }}>
            <button type="button" className="v-btn v-btn-primary" onClick={this.reset}>
              Try Again
            </button>
            {this.props.backHref && (
              <Link href={this.props.backHref} className="v-btn">
                Back to Details
              </Link>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
