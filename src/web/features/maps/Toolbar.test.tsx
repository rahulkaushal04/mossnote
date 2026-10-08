// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetViewportAfterEach, setViewport } from '../../testViewport';
import { DEFAULT_SETTINGS } from './editorTypes';
import { Toolbar, type ToolbarProps } from './Toolbar';

afterEach(cleanup);
resetViewportAfterEach();

function props(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    tool: 'select',
    onTool: vi.fn(),
    settings: DEFAULT_SETTINGS,
    onSettings: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onZoom: vi.fn(),
    onFit: vi.fn(),
    panelOpen: false,
    onPanel: vi.fn(),
    explore: false,
    onExplore: vi.fn(),
    fullscreen: false,
    onFullscreen: vi.fn(),
    onHistory: vi.fn(),
    onDuplicateMap: vi.fn(),
    onExport: vi.fn(),
    exporting: false,
    onMarkerTypes: vi.fn(),
    collapsed: false,
    onCollapsed: vi.fn(),
    ...overrides,
  };
}

describe('Toolbar tools', () => {
  it('has an icon and a name for every tool, and marks the current one', async () => {
    setViewport(1280);
    const p = props({ tool: 'line' });
    render(<Toolbar {...p} />);
    const tools = screen.getByRole('toolbar', { name: 'Map tools' });
    const buttons = within(tools).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    for (const button of buttons) {
      expect(button.querySelector('svg'), button.getAttribute('aria-label') ?? '').not.toBeNull();
    }
    expect(within(tools).getByRole('button', { name: 'Line' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await userEvent.click(within(tools).getByRole('button', { name: 'Box' }));
    expect(p.onTool).toHaveBeenCalledWith('rect');
  });
});

describe('Toolbar on a phone', () => {
  it('can be hidden and shown again, and keeps Undo and Redo while hidden', async () => {
    setViewport(375);
    const onCollapsed = vi.fn();
    const { rerender } = render(<Toolbar {...props({ onCollapsed })} />);
    expect(screen.getByRole('toolbar', { name: 'Map tools' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Hide tools' }));
    expect(onCollapsed).toHaveBeenCalledWith(true);

    rerender(<Toolbar {...props({ onCollapsed, collapsed: true })} />);
    expect(screen.queryByRole('toolbar', { name: 'Map tools' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show tools' }));
    expect(onCollapsed).toHaveBeenLastCalledWith(false);
  });
});

describe('Toolbar on a wide screen', () => {
  it('is always open, so it has nothing to hide', () => {
    setViewport(1280);
    render(<Toolbar {...props({ collapsed: true })} />);
    expect(screen.queryByRole('button', { name: /tools$/ })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Map tools' })).toBeTruthy();
  });
});
