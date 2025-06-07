import React from 'react';
import ReactDOM from 'react-dom/client';
import Popup from './Popup';
import '../popup.css';
import useSnapZone from './hooks/useSnapZone';

function App() {
  useSnapZone();
  return <Popup />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
