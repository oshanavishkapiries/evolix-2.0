"use client";

import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { Switch } from "./switch";
import { useToast } from "./toast";

/** Platform switches. */
export function PlatformSettings({ requireApproval, playerFeedback }: { requireApproval: boolean; playerFeedback: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(requireApproval);
  const [survey, setSurvey] = useState(playerFeedback);
  const toggleSurvey = async (next: boolean) => {
    const res = await adminApi("PUT", "/api/admin/settings", { playerFeedback: next });
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    setSurvey(next);
    toast.success(next ? "Player feedback survey on" : "Player feedback survey off");
    return true;
  };

  const toggle = async (next: boolean) => {
    const res = await adminApi("PUT", "/api/admin/settings", { requireApproval: next });
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    setOn(next);
    toast.success(next ? "Only approved users can watch" : "Everyone can watch");
    return true;
  };

  return (
    <section className="mt-4">
      <h2>Watching</h2>
      <p className="mt-2 text-sm">
        <strong>Require admin approval to watch</strong>: when on, new accounts (after the normal email verification) can sign in and browse, but cannot
        watch movies or TV shows until you approve them in <em>Users</em>. When off, every signed-in user can watch. Accounts that existed before this
        feature are already approved.
      </p>
      <div className="mt-3">
        <Switch checked={on} onToggle={toggle} label="Require admin approval to watch" onLabel="Approval required" offLabel="Everyone can watch" />
      </div>
      <h2 className="mt-6">Player feedback</h2>
      <p className="mt-2 text-sm">
        <strong>Ask viewers to rate playback</strong>: after a viewer has watched for a while, the player sometimes shows a small emoji survey when they
        pause or finish (a random sample, at most once every few days per viewer). Answers appear in <em>Feedback</em>.
      </p>
      <div className="mt-3">
        <Switch checked={survey} onToggle={toggleSurvey} label="Ask viewers to rate playback" onLabel="Survey on" offLabel="Survey off" />
      </div>
    </section>
  );
}
