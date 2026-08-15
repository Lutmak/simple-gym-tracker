import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type QueueRevisionContextType = {
  revision: number;
  bump: () => void;
};

const QueueRevisionContext = createContext<QueueRevisionContextType | undefined>(undefined);

export function QueueRevisionProvider({ children }: { children: React.ReactNode }) {
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((current) => current + 1), []);
  const value = useMemo(() => ({ revision, bump }), [revision, bump]);

  return (
    <QueueRevisionContext.Provider value={value}>{children}</QueueRevisionContext.Provider>
  );
}

export function useQueueRevision() {
  const context = useContext(QueueRevisionContext);
  if (!context) {
    throw new Error('useQueueRevision must be used within a QueueRevisionProvider');
  }
  return context;
}
