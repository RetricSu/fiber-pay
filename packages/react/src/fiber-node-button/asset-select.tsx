import { CUSTOM_ASSET_KEY, localizeAssetLabel, type PanelAssetOption } from './assets.js';
import { styles } from './styles.js';
import type { FiberNodeButtonI18n } from './types.js';

export interface AssetSelectProps {
  label: string;
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<PanelAssetOption>;
  customScript: string;
  onChange: (key: string) => void;
  onCustomScriptChange: (value: string) => void;
  t: FiberNodeButtonI18n;
}

export function AssetSelect({
  label,
  ariaLabel,
  value,
  options,
  customScript,
  onChange,
  onCustomScriptChange,
  t,
}: AssetSelectProps) {
  return (
    <>
      <label style={styles.fieldLabel}>
        {label}
        <select
          style={styles.input}
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {localizeAssetLabel(option.label, t)}
            </option>
          ))}
          <option value={CUSTOM_ASSET_KEY}>{t('asset.custom', 'Custom')}</option>
        </select>
      </label>

      {value === CUSTOM_ASSET_KEY ? (
        <label style={styles.fieldLabel}>
          {t('asset.custom.script', 'Custom UDT Script (JSON)')}
          <textarea
            style={styles.textarea}
            aria-label={`${ariaLabel} ${t('asset.custom.script', 'Custom UDT Script (JSON)')}`}
            rows={4}
            value={customScript}
            onChange={(event) => onCustomScriptChange(event.target.value)}
            placeholder='{"code_hash":"0x...","hash_type":"type","args":"0x..."}'
          />
        </label>
      ) : null}
    </>
  );
}
