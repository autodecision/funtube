import { createRoot } from 'react-dom/client';
import App from './App';
import { TelevisionPreviewProvider } from './contexts/TelevisionPreviewContext';
import './styles/App.css';

createRoot(document.getElementById('root')!).render(
  <TelevisionPreviewProvider><App /></TelevisionPreviewProvider>,
);
