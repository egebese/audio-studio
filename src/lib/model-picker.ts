import type { ModelDefinition } from "./model-catalog";

export interface ModelPickerFilters {
  query?: string;
  provider?: string;
  task?: string;
  bestFor?: string;
}

const supportedLobeProviderKeys = new Set(["minimax", "volcengine"]);

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function lobeProviderIconKey(model: ModelDefinition): string | undefined {
  const key = normalized(model.providerIconKey);
  return supportedLobeProviderKeys.has(key) ? key : undefined;
}

export function modelLettermark(model: ModelDefinition): string {
  return model.provider
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || model.label[0]?.toUpperCase() || "M";
}

export function modelProviderOptions(models: ModelDefinition[]): string[] {
  return [...new Set(models.map((model) => model.provider))].sort();
}

export function modelTaskOptions(models: ModelDefinition[]): string[] {
  return [...new Set(models.map((model) => model.task))].sort();
}

export function modelBestForOptions(models: ModelDefinition[]): string[] {
  return [...new Set(models.flatMap((model) => model.bestFor))].sort();
}

export function filterModels(
  models: ModelDefinition[],
  filters: ModelPickerFilters
): ModelDefinition[] {
  const query = normalized(filters.query);
  const provider = normalized(filters.provider);
  const task = normalized(filters.task);
  const bestFor = normalized(filters.bestFor);

  return models.filter((model) => {
    if (provider && normalized(model.provider) !== provider) return false;
    if (task && model.task !== task) return false;
    if (bestFor && !model.bestFor.some((item) => normalized(item) === bestFor)) return false;
    if (!query) return true;

    const haystack = [
      model.label,
      model.provider,
      model.description,
      model.kind,
      model.task,
      ...model.bestFor,
      ...model.capabilities,
      ...model.routingKeywords
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function groupModelsByProvider(
  models: ModelDefinition[]
): Array<{ provider: string; models: ModelDefinition[] }> {
  return modelProviderOptions(models)
    .map((provider) => ({
      provider,
      models: models.filter((model) => model.provider === provider)
    }))
    .filter((group) => group.models.length > 0);
}
