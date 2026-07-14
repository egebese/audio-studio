"use client";

import * as React from "react";
import { modelCatalog } from "@/lib/model-catalog";
import {
  filterModels,
  groupModelsByProvider,
  modelBestForOptions,
  modelProviderOptions,
  modelTaskOptions
} from "@/lib/model-picker";

// Owns the Generate model-picker UI state (search, filters, keyboard highlight) and the
// derived, filtered/grouped model lists it renders.
export function useModelPicker() {
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [modelQuery, setModelQuery] = React.useState("");
  const [modelProviderFilter, setModelProviderFilter] = React.useState("");
  const [modelTaskFilter, setModelTaskFilter] = React.useState("");
  const [modelBestForFilter, setModelBestForFilter] = React.useState("");
  const [modelActiveIndex, setModelActiveIndex] = React.useState(-1);
  const [featuredExpanded, setFeaturedExpanded] = React.useState(false);

  React.useEffect(() => {
    setModelActiveIndex(-1);
  }, [modelQuery, modelProviderFilter, modelTaskFilter, modelBestForFilter, modelPickerOpen]);

  const modelProviderFilters = modelProviderOptions(modelCatalog);
  const modelTaskFilters = modelTaskOptions(modelCatalog);
  const modelBestForFilters = modelBestForOptions(modelCatalog);
  const filteredModelsForPicker = filterModels(modelCatalog, {
    query: modelQuery,
    provider: modelProviderFilter,
    task: modelTaskFilter,
    bestFor: modelBestForFilter
  });
  const featuredModels = filteredModelsForPicker.filter((item) => item.featured);
  const groupedPickerModels = groupModelsByProvider(filteredModelsForPicker);
  const keyboardModel = filteredModelsForPicker[modelActiveIndex];

  return {
    modelPickerOpen,
    setModelPickerOpen,
    modelQuery,
    setModelQuery,
    modelProviderFilter,
    setModelProviderFilter,
    modelTaskFilter,
    setModelTaskFilter,
    modelBestForFilter,
    setModelBestForFilter,
    modelActiveIndex,
    setModelActiveIndex,
    featuredExpanded,
    setFeaturedExpanded,
    modelProviderFilters,
    modelTaskFilters,
    modelBestForFilters,
    filteredModelsForPicker,
    featuredModels,
    groupedPickerModels,
    keyboardModel
  };
}
