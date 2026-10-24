'use client';

import { createContext, useContext } from 'react';

/** Suspend page-wide shortcuts while retaining live editors and collaboration. */
export const PageVisibility = createContext(true);
export const usePageVisible = () => useContext(PageVisibility);
