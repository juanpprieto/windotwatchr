import ReactDOM from 'react-dom';
import { act as flush } from 'react-dom/test-utils';

/** Test adapter for the advertised peer minimum; never part of the package. */
export function createRoot(container: HTMLElement) {
  return {
    render(element: React.ReactElement) { ReactDOM.render(element, container); },
    unmount() { ReactDOM.unmountComponentAtNode(container); },
  };
}
export async function act(callback: () => unknown) {
  let pending: unknown;
  flush(() => { pending = callback(); });
  await pending;
  flush(() => {});
}
