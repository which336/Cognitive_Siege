import { TowerKind } from '../types';
import { TOWER_DEFS } from '../game/data/towers';
import { el } from './dom';

export interface TowerActionPopupOpts {
  /** Anchor point in screen-space pixels (game canvas already absolutely positioned). */
  x: number;
  y: number;
  kind: TowerKind;
  level: number;
  damageLabel: string;
  rangeLabel: string;
  fireRateLabel: string;
  upgradeCost: number | null;   // null when maxed
  sellRefund: number;
  canAfford: boolean;
  onUpgrade: () => void;
  onSell: () => void;
  onClose: () => void;
}

export function showTowerActionPopup(opts: TowerActionPopupOpts): { close: () => void } {
  const def = TOWER_DEFS[opts.kind];
  // Backdrop catches clicks outside the popup; closes it.
  const backdrop = el('div', {
    cls: 'cs-tower-popup-backdrop',
    on: {
      click: () => {
        cleanup();
        opts.onClose();
      },
    },
  });

  const card = el('div', { cls: 'cs-tower-popup' });
  card.style.left = `${Math.round(opts.x)}px`;
  card.style.top = `${Math.round(opts.y)}px`;
  card.addEventListener('click', e => e.stopPropagation());

  const title = el('div', { cls: 'cs-tower-popup-title' }, [
    el('span', { cls: 'cs-tower-popup-glyph', text: def.emoji }),
    el('span', { text: `${def.displayName}` }),
    el('span', { cls: 'cs-tower-popup-level', text: ` · L${opts.level}` }),
  ]);

  const stats = el('div', { cls: 'cs-tower-popup-stats' }, [
    el('div', { html: `<span>伤害</span><b>${opts.damageLabel}</b>` }),
    el('div', { html: `<span>射程</span><b>${opts.rangeLabel}</b>` }),
    el('div', { html: `<span>射速</span><b>${opts.fireRateLabel}</b>` }),
  ]);

  const actions = el('div', { cls: 'cs-tower-popup-actions' });

  if (opts.upgradeCost == null) {
    const maxBtn = el('button', {
      cls: 'cs-tower-popup-btn maxed',
      text: '已达 L3 满级',
      attrs: { disabled: 'true' },
    });
    actions.appendChild(maxBtn);
  } else {
    const upBtn = el('button', {
      cls: 'cs-tower-popup-btn upgrade' + (opts.canAfford ? '' : ' disabled'),
      html: `升级到 L${opts.level + 1}<small>${opts.upgradeCost} 念力</small>`,
      on: {
        click: () => {
          if (!opts.canAfford) return;
          cleanup();
          opts.onUpgrade();
        },
      },
    });
    if (!opts.canAfford) upBtn.setAttribute('disabled', 'true');
    actions.appendChild(upBtn);
  }

  const sellBtn = el('button', {
    cls: 'cs-tower-popup-btn sell',
    html: `拆除<small>返还 ${opts.sellRefund} 念力</small>`,
    on: {
      click: () => {
        cleanup();
        opts.onSell();
      },
    },
  });
  actions.appendChild(sellBtn);

  card.appendChild(title);
  card.appendChild(stats);
  card.appendChild(actions);

  document.body.appendChild(backdrop);
  document.body.appendChild(card);

  // Make sure popup stays inside viewport
  requestAnimationFrame(() => {
    const r = card.getBoundingClientRect();
    const margin = 8;
    if (r.right > window.innerWidth - margin) {
      card.style.left = `${Math.max(margin, window.innerWidth - margin - r.width)}px`;
    }
    if (r.left < margin) {
      card.style.left = `${margin}px`;
    }
    if (r.bottom > window.innerHeight - margin) {
      card.style.top = `${Math.max(margin, opts.y - r.height - 36)}px`;
    }
  });

  let closed = false;
  function cleanup(): void {
    if (closed) return;
    closed = true;
    backdrop.remove();
    card.remove();
  }

  return { close: cleanup };
}
