import { createRoot } from 'react-dom/client';
import { VirtualIpod, RemoteStorage } from '@podkit/ipod-web';

const SERVER_PORT = 3456;
const storage = new RemoteStorage(`http://localhost:${SERVER_PORT}`);

function App() {
  return <VirtualIpod storage={storage} variant="white" />;
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
