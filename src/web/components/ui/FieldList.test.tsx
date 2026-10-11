// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomField } from '@shared/types';
import { api } from '../../lib/api';
import { FieldList } from './FieldList';

const setup = (fields: CustomField[]) => {
  vi.spyOn(api, 'fieldLabels').mockResolvedValue({ labels: [] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FieldList fields={fields} kind="person" onChange={() => undefined} />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FieldList', () => {
  it('says why a row with a value but no label is not saved', () => {
    setup([{ label: '', value: 'Cheese' }]);

    expect(screen.getByText('Add a label to save this field.')).toBeTruthy();
  });

  it('says nothing about a new empty row or a complete one', () => {
    setup([
      { label: '', value: '' },
      { label: 'Likes', value: 'Cheese' },
    ]);

    expect(screen.queryByText('Add a label to save this field.')).toBeNull();
  });
});
