import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LoadingScreen } from '../../src/ui/screens/LoadingScreen';

afterEach(cleanup);

describe('LoadingScreen', () => {
  it('pokazuje dokładną nazwę aplikacji i status', () => {
    render(<LoadingScreen />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Doktor Monika Egzamin');
    expect(screen.getByRole('status').textContent).toBe('Wczytywanie…');
  });
});
