import { useState, useEffect, useCallback } from "react";

export interface Settings {
  navbarFontSize: number; // 12-18px
  terminalFontSize: number; // 10-20px
}

const DEFAULT_SETTINGS: Settings = {
  navbarFontSize: 16,
  terminalFontSize: 16,
};

const STORAGE_KEY = "claude-run-settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch {
      // Ignore errors, use defaults
    }
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, []);

  const setNavbarFontSize = useCallback(
    (size: number) => saveSettings({ navbarFontSize: Math.min(18, Math.max(12, size)) }),
    [saveSettings]
  );

  const setTerminalFontSize = useCallback(
    (size: number) => saveSettings({ terminalFontSize: Math.min(20, Math.max(10, size)) }),
    [saveSettings]
  );

  return {
    settings,
    setNavbarFontSize,
    setTerminalFontSize,
  };
}
