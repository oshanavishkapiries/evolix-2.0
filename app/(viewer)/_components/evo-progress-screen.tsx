"use client";

import Link from "next/link";
import { imageUrl } from "@/lib/images";
import "../styles/evo-progress.css";

type Props = {
  title: string;
  backdropPath?: string | null;
  status: "PENDING" | "EXTRACTING" | "DOWNLOADING" | "UPLOADING" | "COMPLETED" | "FAILED";
  progressPct: number;
  message: string;
  error?: string | null;
  onRetry?: () => void;
  backHref: string;
};

export function EvoProgressScreen({
  title,
  backdropPath,
  status,
  progressPct,
  message,
  error,
  onRetry,
  backHref,
}: Props) {
  const bg = backdropPath ? imageUrl(backdropPath, "w1280") : null;

  // Determine stage flags
  const isExtracting = status === "EXTRACTING" || status === "PENDING";
  const isDownloading = status === "DOWNLOADING";
  const isUploading = status === "UPLOADING" || status === "COMPLETED";

  const isStep1Done = status === "DOWNLOADING" || status === "UPLOADING" || status === "COMPLETED";
  const isStep2Done = status === "UPLOADING" || status === "COMPLETED";
  const isStep3Done = status === "COMPLETED";

  return (
    <div className="evo-screen">
      {bg && <div className="evo-backdrop" style={{ backgroundImage: `url("${bg}")` }} />}

      <div className="evo-container">
        <div className="evo-header">
          <span className="evo-badge">
            <span className="v-spin" style={{ width: ".75rem", height: ".75rem" }} />
            Evo Engine On-Demand
          </span>
          <h1 className="evo-title">{title}</h1>
          <p className="evo-status-message">
            {error ? <span style={{ color: "var(--v-danger)" }}>{error}</span> : message}
          </p>
        </div>

        {!error && (
          <div className="evo-progress-box">
            <div className="evo-progress-bar">
              <div
                className="evo-progress-fill"
                style={{ width: `${Math.max(4, Math.min(100, progressPct))}%` }}
              />
            </div>
            <div className="evo-progress-meta">
              <span>{status}</span>
              <span>{progressPct}%</span>
            </div>
          </div>
        )}

        <div className="evo-stages">
          <div
            className="evo-stage-step"
            data-active={isExtracting && !error}
            data-done={isStep1Done}
          >
            <div className="evo-stage-dot">{isStep1Done ? "✓" : "1"}</div>
            <span>Decrypt Stream</span>
          </div>

          <div
            className="evo-stage-step"
            data-active={isDownloading && !error}
            data-done={isStep2Done}
          >
            <div className="evo-stage-dot">{isStep2Done ? "✓" : "2"}</div>
            <span>Fast Ingest</span>
          </div>

          <div
            className="evo-stage-step"
            data-active={isUploading && !error}
            data-done={isStep3Done}
          >
            <div className="evo-stage-dot">{isStep3Done ? "✓" : "3"}</div>
            <span>CDN Cloud Sync</span>
          </div>
        </div>

        <div className="evo-actions">
          {error && onRetry && (
            <button type="button" className="v-btn v-btn-primary" onClick={onRetry}>
              Try Again
            </button>
          )}
          <Link href={backHref} className="v-btn">
            Back to Details
          </Link>
        </div>
      </div>
    </div>
  );
}
