import { Suspense } from "react";
import { openRouterModels } from "@/lib/openrouter";
import { OpenRouterPanel } from "../_components/openrouter-panel";
import { PageHeader } from "../_components/page-header";
import { TranslateModel } from "../_components/translate-model";

async function Model() {
  return <TranslateModel models={await openRouterModels()} />;
}

export default function OpenRouterPage() {
  return (
    <>
      <PageHeader title="OpenRouter" />
      <Suspense fallback={<div className="skeleton mt-4 h-40" aria-busy="true" />}>
        <Model />
      </Suspense>
      <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
        <OpenRouterPanel />
      </Suspense>
    </>
  );
}
