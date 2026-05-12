import { ConfigLoadReport } from '../game/data/configLoader';
import { el, mountOverlay } from './dom';

export function showConfigStatus(report: ConfigLoadReport, onClose: () => void): { close: () => void } {
  const isOk = report.status === 'ok';
  const panel = el('div', { cls: 'cs-panel wide' });

  panel.appendChild(el('div', { cls: 'cs-panel-title', text: '配置校验报告' }));
  panel.appendChild(el('div', {
    cls: 'cs-panel-sub',
    text: isOk ? '运行时 CSV 已通过基础校验' : '外部配置未生效，当前使用内置默认值',
  }));

  panel.appendChild(el('div', { cls: `cs-config-status ${isOk ? 'ok' : 'fallback'}` }, [
    el('div', { cls: 'state', text: isOk ? '通过' : '回退' }),
    el('div', { cls: 'message', text: report.message }),
    el('div', { cls: 'time', text: report.checkedAt ? `检查时间：${report.checkedAt}` : '尚未检查' }),
  ]));

  if (report.error) {
    panel.appendChild(el('div', { cls: 'cs-section-label', text: '错误定位' }));
    panel.appendChild(el('pre', { cls: 'cs-config-error', text: report.error }));
  }

  panel.appendChild(el('div', { cls: 'cs-section-label', text: '已纳入校验的配置表' }));
  const grid = el('div', { cls: 'cs-config-table-grid' });
  const tables = report.loadedTables.length ? report.loadedTables : [
    'tower_config.csv',
    'enemy_config.csv',
    'wave_config.csv',
    'wave_spawn_groups.csv',
    'ai_safety_config.csv',
    'tutorial_config.csv',
    'map_routes.csv',
    'map_build_cells.csv',
    'map_route_rules.csv',
    'enemy_route_preferences.csv',
    'route_strategy_weights.csv',
    'mind_cache_config.csv',
    'difficulty_config.csv',
    'wave_scaling_config.csv',
    'boss_combat_config.csv',
  ];
  for (const table of tables) {
    grid.appendChild(el('div', { cls: 'cs-config-table-chip', text: table }));
  }
  panel.appendChild(grid);

  panel.appendChild(el('div', { cls: 'cs-disclaimer', text: '校验范围：空表、必填行、枚举、数字范围、路线列表、技能列表、1-10 波完整性。校验失败时会保留内置默认值，保证演示可继续。' }));

  const actions = el('div', { cls: 'cs-actions' });
  actions.appendChild(el('button', {
    cls: 'cs-btn primary',
    text: '关闭',
    on: { click: () => close() },
  }));
  panel.appendChild(actions);

  const handle = mountOverlay(panel);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    close();
  };
  window.addEventListener('keydown', onKeyDown);

  function close(): void {
    window.removeEventListener('keydown', onKeyDown);
    handle.close();
    onClose();
  }

  return { close };
}
