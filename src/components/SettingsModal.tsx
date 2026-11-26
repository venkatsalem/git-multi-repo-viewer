import React, { useEffect, useState } from 'react';
import {
  Minus,
  Monitor,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Sun,
  X
} from 'lucide-react';
import {
  DEFAULT_FONT_PREFERENCES,
  EDITOR_FONT_PRESETS,
  FontPreferences,
  UI_FONT_PRESETS
} from '../utils/fontPreferences';

export type ThemePreference = 'system' | 'light' | 'dark';

type SettingsSection = 'appearance';

interface SettingsModalProps {
  themePreference: ThemePreference;
  onChangeTheme: (next: ThemePreference) => void;
  fontPreferences: FontPreferences;
  onChangeFonts: (next: FontPreferences) => void;
  onClose: () => void;
}

const CUSTOM_OPTION = '__custom__';
const UI_FONT_SIZES = [11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16];
const EDITOR_FONT_SIZES = [10, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 18, 20];

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: React.FC<{ size?: number }>;
}> = [{ id: 'appearance', label: 'Appearance', icon: Palette }];

function stepSize(
  current: number,
  list: number[],
  direction: 1 | -1
): number {
  const idx = list.findIndex((s) => s >= current);
  if (idx === -1) return direction === -1 ? list[list.length - 1] : current;
  if (list[idx] !== current) {
    return direction === 1 ? list[idx] : list[Math.max(0, idx - 1)];
  }
  const nextIdx = Math.min(list.length - 1, Math.max(0, idx + direction));
  return list[nextIdx];
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  themePreference,
  onChangeTheme,
  fontPreferences,
  onChangeFonts,
  onClose
}) => {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('appearance');

  const isUiPreset = UI_FONT_PRESETS.some(
    (p) => p.value === fontPreferences.uiFont
  );
  const isEditorPreset = EDITOR_FONT_PRESETS.some(
    (p) => p.value === fontPreferences.editorFont
  );

  const [uiCustomMode, setUiCustomMode] = useState(!isUiPreset);
  const [editorCustomMode, setEditorCustomMode] = useState(!isEditorPreset);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const uiSizes = UI_FONT_SIZES.includes(fontPreferences.uiFontSize)
    ? UI_FONT_SIZES
    : [...UI_FONT_SIZES, fontPreferences.uiFontSize].sort((a, b) => a - b);

  const editorSizes = EDITOR_FONT_SIZES.includes(
    fontPreferences.editorFontSize
  )
    ? EDITOR_FONT_SIZES
    : [...EDITOR_FONT_SIZES, fontPreferences.editorFontSize].sort(
        (a, b) => a - b
      );

  const handleResetAppearance = () => {
    setUiCustomMode(false);
    setEditorCustomMode(false);
    onChangeTheme('system');
    onChangeFonts({ ...DEFAULT_FONT_PREFERENCES });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card settings-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3>Settings</h3>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings categories">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon size={14} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="settings-content">
            {activeSection === 'appearance' && (
              <>
                <div className="settings-section">
                  <div className="settings-section-title">Theme</div>
                  <div className="theme-segmented">
                    {(
                      [
                        { id: 'system', label: 'System', Icon: Monitor },
                        { id: 'light', label: 'Light', Icon: Sun },
                        { id: 'dark', label: 'Dark', Icon: Moon }
                      ] as const
                    ).map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        className={`theme-segment-btn ${themePreference === id ? 'active' : ''}`}
                        onClick={() => onChangeTheme(id)}
                      >
                        <Icon size={14} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">Fonts</div>

                  <div className="settings-grid-2">
                    <label className="settings-field">
                      <span>UI Font Family</span>
                      <select
                        value={
                          uiCustomMode
                            ? CUSTOM_OPTION
                            : fontPreferences.uiFont
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === CUSTOM_OPTION) {
                            setUiCustomMode(true);
                          } else {
                            setUiCustomMode(false);
                            onChangeFonts({ ...fontPreferences, uiFont: v });
                          }
                        }}
                      >
                        {UI_FONT_PRESETS.map((p) => (
                          <option key={p.label} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                        <option value={CUSTOM_OPTION}>
                          Custom installed font...
                        </option>
                      </select>
                    </label>

                    <div className="settings-field">
                      <span>UI Font Size</span>
                      <div className="size-stepper">
                        <button
                          type="button"
                          className="btn size-step-btn"
                          onClick={() =>
                            onChangeFonts({
                              ...fontPreferences,
                              uiFontSize: stepSize(
                                fontPreferences.uiFontSize,
                                UI_FONT_SIZES,
                                -1
                              )
                            })
                          }
                          title="Decrease UI font size"
                        >
                          <Minus size={13} />
                        </button>
                        <select
                          value={fontPreferences.uiFontSize}
                          onChange={(e) =>
                            onChangeFonts({
                              ...fontPreferences,
                              uiFontSize: Number.parseFloat(e.target.value)
                            })
                          }
                        >
                          {uiSizes.map((sz) => (
                            <option key={sz} value={sz}>
                              {sz} px
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn size-step-btn"
                          onClick={() =>
                            onChangeFonts({
                              ...fontPreferences,
                              uiFontSize: stepSize(
                                fontPreferences.uiFontSize,
                                UI_FONT_SIZES,
                                1
                              )
                            })
                          }
                          title="Increase UI font size"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {uiCustomMode && (
                    <label className="settings-field">
                      <span>Custom UI Font Family CSS</span>
                      <input
                        type="text"
                        value={fontPreferences.uiFont}
                        onChange={(e) =>
                          onChangeFonts({
                            ...fontPreferences,
                            uiFont: e.target.value
                          })
                        }
                        placeholder="e.g. 'Inter', 'Segoe UI', sans-serif"
                      />
                    </label>
                  )}

                  <div className="settings-grid-2">
                    <label className="settings-field">
                      <span>Diff / Editor Font Family</span>
                      <select
                        value={
                          editorCustomMode
                            ? CUSTOM_OPTION
                            : fontPreferences.editorFont
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === CUSTOM_OPTION) {
                            setEditorCustomMode(true);
                          } else {
                            setEditorCustomMode(false);
                            onChangeFonts({
                              ...fontPreferences,
                              editorFont: v
                            });
                          }
                        }}
                      >
                        {EDITOR_FONT_PRESETS.map((p) => (
                          <option key={p.label} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                        <option value={CUSTOM_OPTION}>
                          Custom installed font...
                        </option>
                      </select>
                    </label>

                    <div className="settings-field">
                      <span>Diff / Editor Font Size</span>
                      <div className="size-stepper">
                        <button
                          type="button"
                          className="btn size-step-btn"
                          onClick={() =>
                            onChangeFonts({
                              ...fontPreferences,
                              editorFontSize: stepSize(
                                fontPreferences.editorFontSize,
                                EDITOR_FONT_SIZES,
                                -1
                              )
                            })
                          }
                          title="Decrease editor font size"
                        >
                          <Minus size={13} />
                        </button>
                        <select
                          value={fontPreferences.editorFontSize}
                          onChange={(e) =>
                            onChangeFonts({
                              ...fontPreferences,
                              editorFontSize: Number.parseFloat(e.target.value)
                            })
                          }
                        >
                          {editorSizes.map((sz) => (
                            <option key={sz} value={sz}>
                              {sz} px
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn size-step-btn"
                          onClick={() =>
                            onChangeFonts({
                              ...fontPreferences,
                              editorFontSize: stepSize(
                                fontPreferences.editorFontSize,
                                EDITOR_FONT_SIZES,
                                1
                              )
                            })
                          }
                          title="Increase editor font size"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {editorCustomMode && (
                    <label className="settings-field">
                      <span>Custom Editor Font Family CSS</span>
                      <input
                        type="text"
                        value={fontPreferences.editorFont}
                        onChange={(e) =>
                          onChangeFonts({
                            ...fontPreferences,
                            editorFont: e.target.value
                          })
                        }
                        placeholder="e.g. 'Fira Code', Consolas, monospace"
                      />
                    </label>
                  )}

                  <div className="font-preview-box">
                    <div className="font-preview-label">
                      Live Editor Preview ({fontPreferences.editorFontSize}px)
                    </div>
                    <div className="font-preview-editor">
                      <div style={{ color: 'var(--status-a)' }}>
                        + export function scanWorkspace(root: string) &#123;
                      </div>
                      <div style={{ color: 'var(--status-d)' }}>
                        - return scanLegacy(root);
                      </div>
                      <div style={{ color: 'var(--text-primary)' }}>
                        &nbsp;&nbsp;return findNestedRepos(root); &#125;
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button
            type="button"
            className="btn"
            onClick={handleResetAppearance}
          >
            <RotateCcw size={13} />
            Reset Defaults
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
