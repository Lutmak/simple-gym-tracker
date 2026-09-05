import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { Stat } from './Stat';

describe('Stat', () => {
  it('renders the value, unit and label', () => {
    render(<Stat label="semanas" value="18" testID="streak" />);

    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('semanas')).toBeTruthy();
  });

  it('renders no swatch or trend glyph by default', () => {
    render(<Stat label="semanas" value="18" testID="streak" />);

    expect(screen.queryByTestId('streak-swatch')).toBeNull();
    expect(screen.queryByTestId('streak-trend')).toBeNull();
  });

  it('renders a colour swatch when given one', () => {
    render(<Stat label="Ciclo 4" value="Sem 2" color="#2A78D6" testID="cycle" />);

    expect(screen.getByTestId('cycle-swatch')).toBeTruthy();
  });

  it('picks the up/down/flat glyph for its trend', () => {
    const up = render(<Stat label="press" value="62.5" unit="kg" trend="up" />);
    expect(up.UNSAFE_root.findByProps({ name: 'arrow-up' })).toBeTruthy();
    up.unmount();

    const down = render(<Stat label="press" value="62.5" unit="kg" trend="down" />);
    expect(down.UNSAFE_root.findByProps({ name: 'arrow-down' })).toBeTruthy();
    down.unmount();

    const flat = render(<Stat label="press" value="62.5" unit="kg" trend="flat" />);
    expect(flat.UNSAFE_root.findByProps({ name: 'remove' })).toBeTruthy();
  });
});
