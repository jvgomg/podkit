import React from 'react';
import { useAtomValue } from 'jotai';
import { currentItemsAtom, selectedIndexAtom } from '../../store/navigation.js';
import { ListView } from '../shared/ListView.js';

export function MenuScreen() {
  const items = useAtomValue(currentItemsAtom);
  const selectedIndex = useAtomValue(selectedIndexAtom);

  return <ListView items={items} selectedIndex={selectedIndex} />;
}
