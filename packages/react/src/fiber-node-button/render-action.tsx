import type { CSSProperties, ReactNode } from 'react';
import type { UseFiberNodeResult } from '../use-fiber-node.js';
import { styles } from './styles.js';
import type {
  FiberNodeButtonActionDefaultProps,
  FiberNodeButtonActionId,
  FiberNodeButtonI18n,
  FiberNodeButtonRenderAction,
} from './types.js';
import { withDisabledStyle } from './utils.js';

export interface RenderPanelActionOptions {
  id: FiberNodeButtonActionId;
  defaultProps: FiberNodeButtonActionDefaultProps;
  fiber: UseFiberNodeResult;
  renderAction?: FiberNodeButtonRenderAction;
  t: FiberNodeButtonI18n;
  buttonStyle?: CSSProperties;
}

export function renderPanelAction(options: RenderPanelActionOptions): ReactNode {
  const { id, defaultProps, fiber, renderAction, t, buttonStyle = styles.actionButton } = options;

  const customAction = renderAction?.({
    id,
    defaultProps,
    fiber,
    t,
  });

  if (customAction !== undefined) {
    return customAction;
  }

  const loadingText = defaultProps.loadingLabel ?? t('actions.loading.default', 'Processing...');

  return (
    <button
      type="button"
      style={withDisabledStyle(buttonStyle, defaultProps.disabled)}
      disabled={defaultProps.disabled}
      onClick={() => {
        void defaultProps.onTrigger();
      }}
    >
      {defaultProps.loading ? loadingText : defaultProps.label}
    </button>
  );
}
