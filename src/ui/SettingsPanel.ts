import { UserSettings } from '../types';
import { loadSettings, saveSettings } from '../settings';
import { el, mountOverlay } from './dom';
import { Sound } from '../game/systems/Audio';

export function showSettings(onClose: (s: UserSettings) => void): { close: () => void } {
  const cur = loadSettings();
  const panel = el('div', { cls: 'cs-panel' });

  panel.appendChild(el('div', { cls: 'cs-panel-title', text: '设置 / SETTINGS' }));
  panel.appendChild(el('div', { cls: 'cs-panel-sub', text: 'AI · DIFFICULTY · DEMO MODE' }));

  // Demo mode
  const demoCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  demoCheck.checked = cur.demoMode;
  panel.appendChild(el('div', { cls: 'cs-section' }, [
    el('label', { cls: 'cs-checkbox' }, [
      demoCheck,
      el('span', { text: '演示模式（使用本地心声库，无需 API Key，最稳定）' }),
    ]),
  ]));

  // Mute
  const muteCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  muteCheck.checked = cur.muted;
  panel.appendChild(el('div', { cls: 'cs-section' }, [
    el('label', { cls: 'cs-checkbox' }, [
      muteCheck,
      el('span', { text: '静音（关闭所有音效与环境音）' }),
    ]),
  ]));

  // API base
  const apiBaseInput = el('input', {
    cls: 'cs-input',
    attrs: { type: 'text', placeholder: 'https://api.deepseek.com/v1' },
  }) as HTMLInputElement;
  apiBaseInput.value = cur.apiBase;
  panel.appendChild(el('div', { cls: 'cs-section' }, [
    el('div', { cls: 'cs-section-label', text: 'API Base URL（OpenAI 兼容）' }),
    apiBaseInput,
  ]));

  // Model
  const modelInput = el('input', {
    cls: 'cs-input',
    attrs: { type: 'text', placeholder: 'deepseek-chat / glm-4-flash / qwen-turbo / gpt-4o-mini …' },
  }) as HTMLInputElement;
  modelInput.value = cur.model;
  panel.appendChild(el('div', { cls: 'cs-section' }, [
    el('div', { cls: 'cs-section-label', text: 'Model 名称' }),
    modelInput,
  ]));

  // API key
  const apiKeyInput = el('input', {
    cls: 'cs-input',
    attrs: { type: 'password', placeholder: 'sk-... (仅保存在你本地浏览器 localStorage)' },
  }) as HTMLInputElement;
  apiKeyInput.value = cur.apiKey;
  panel.appendChild(el('div', { cls: 'cs-section' }, [
    el('div', { cls: 'cs-section-label', text: 'API Key' }),
    apiKeyInput,
  ]));

  // Difficulty
  const diffSelect = el('select', { cls: 'cs-select' }, [
    el('option', { attrs: { value: 'easy' }, text: '宽容（理智值容错高）' }),
    el('option', { attrs: { value: 'normal' }, text: '常规（默认）' }),
    el('option', { attrs: { value: 'hard' }, text: '严苛（敌人更聪明，理智值少）' }),
  ]) as HTMLSelectElement;
  diffSelect.value = cur.difficulty;
  panel.appendChild(el('div', { cls: 'cs-section' }, [
    el('div', { cls: 'cs-section-label', text: '难度' }),
    diffSelect,
  ]));

  panel.appendChild(el('div', { cls: 'cs-disclaimer', text:
    '提示：API Key 仅保存在你本地浏览器，绝不会发送到任何第三方服务器。游戏会以 OpenAI Chat Completions 协议直接请求你填的 API Base。' +
    '若你只是想体验，请保留"演示模式"勾选——所有 LLM 输出会改为来自本地预生成"心声库"。',
  }));

  panel.appendChild(el('div', { cls: 'cs-actions' }, [
    el('button', {
      cls: 'cs-btn ghost',
      text: '取消',
      on: { click: () => handle.close() },
    }),
    el('button', {
      cls: 'cs-btn primary',
      text: '保存',
      on: {
        click: () => {
          const next: UserSettings = {
            apiBase: apiBaseInput.value.trim() || cur.apiBase,
            apiKey: apiKeyInput.value.trim(),
            model: modelInput.value.trim() || cur.model,
            demoMode: demoCheck.checked,
            difficulty: diffSelect.value as UserSettings['difficulty'],
            muted: muteCheck.checked,
          };
          saveSettings(next);
          Sound.setMuted(next.muted);
          handle.close();
          onClose(next);
        },
      },
    }),
  ]));

  const handle = mountOverlay(panel);
  return handle;
}
