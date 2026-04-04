import React from 'react';
import { createRoot } from 'react-dom/client';
import { VirtualIpod } from './ui/VirtualIpod.js';

const root = createRoot(document.getElementById('root')!);
root.render(<VirtualIpod />);
