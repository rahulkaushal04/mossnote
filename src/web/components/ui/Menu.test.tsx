// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetViewportAfterEach, setViewport } from '../../testViewport';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './Menu';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

afterEach(cleanup);
resetViewportAfterEach();

const renderMenu = () =>
  render(
    <Menu>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuContent>
        <MenuItem>Rename</MenuItem>
      </MenuContent>
    </Menu>,
  );

const renderPopover = () =>
  render(
    <Popover>
      <PopoverTrigger>Pick</PopoverTrigger>
      <PopoverContent>Choices</PopoverContent>
    </Popover>,
  );

describe('Menu', () => {
  it('is a bottom sheet over a scrim on a phone, and the item is still reachable', async () => {
    setViewport(375);
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menu').getAttribute('data-presentation')).toBe('sheet');
    expect(document.querySelector('[data-sheet-scrim]')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
  });

  it('is an anchored menu with no scrim on a tablet and wide screens', async () => {
    for (const width of [768, 1280]) {
      cleanup();
      setViewport(width);
      renderMenu();
      await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
      expect(screen.getByRole('menu').getAttribute('data-presentation'), `${width}px`).toBe(
        'popover',
      );
      expect(document.querySelector('[data-sheet-scrim]')).toBeNull();
    }
  });
});

describe('Popover', () => {
  it('is a bottom sheet over a scrim on a phone', async () => {
    setViewport(375);
    renderPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Pick' }));
    expect(
      screen.getByText('Choices').closest('[data-presentation]')?.getAttribute('data-presentation'),
    ).toBe('sheet');
    expect(document.querySelector('[data-sheet-scrim]')).not.toBeNull();
  });

  it('is anchored with no scrim on a tablet and wide screens', async () => {
    setViewport(900);
    renderPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Pick' }));
    expect(
      screen.getByText('Choices').closest('[data-presentation]')?.getAttribute('data-presentation'),
    ).toBe('popover');
    expect(document.querySelector('[data-sheet-scrim]')).toBeNull();
  });
});
