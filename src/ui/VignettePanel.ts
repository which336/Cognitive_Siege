import { VignetteContext } from '../types';
import { el, mountOverlay, typewriter } from './dom';

export function showVignette(v: VignetteContext, onContinue: () => void): { close: () => void } {
  const panel = el('div', { cls: 'cs-panel' });
  panel.appendChild(el('div', { cls: 'cs-panel-title', text: `Night ${v.night}` }));
  panel.appendChild(el('div', { cls: 'cs-panel-sub', text: `${v.patientName} · ${v.emotion}` }));

  const vignetteEl = el('div', { cls: 'cs-vignette' });
  panel.appendChild(vignetteEl);
  typewriter(vignetteEl, v.hint, 38);

  panel.appendChild(el('div', { cls: 'cs-disclaimer', text: '本作为虚构作品，并不替代任何真实心理治疗。所有"心魔"均为人格化的叙事象征。' }));

  panel.appendChild(el('div', { cls: 'cs-actions' }, [
    el('button', {
      cls: 'cs-btn primary',
      text: '进入梦境 / Enter',
      on: { click: () => { handle.close(); onContinue(); } },
    }),
  ]));

  const handle = mountOverlay(panel);
  return handle;
}
