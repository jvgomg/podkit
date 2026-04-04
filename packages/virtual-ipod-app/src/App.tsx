import { createRoot } from 'react-dom/client';
import { VirtualIpod, RemoteStorage } from '@podkit/ipod-web';
import './App.css';

const SERVER_PORT = 3456;
const storage = new RemoteStorage(`http://localhost:${SERVER_PORT}`);

function App() {
  return (
    <div className="ipod-wrapper">
      <div className="ipod-container">
        <VirtualIpod storage={storage} variant="white" />
        <div className="ipod-grip" data-tauri-drag-region>
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
