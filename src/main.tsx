import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary, GlobalErrorHandler } from "./components/ErrorBoundary";
import { I18nProvider } from "./hooks/useI18n";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <GlobalErrorHandler>
          <App />
        </GlobalErrorHandler>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
