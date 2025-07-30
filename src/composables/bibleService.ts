// Define BibleData interface
export interface BibleData {
  books: Book[]
  version: string
  language: string
}

export interface Book {
  name: string
  chapters: Chapter[]
  testament: 'old' | 'new'
}

export interface Chapter {
  number: number
  verses: Verse[]
}

export interface Verse {
  number: number
  text: string
}

export class BibleService {
  private static instance: BibleService
  private bibleData: Map<string, BibleData> = new Map()
  private corsProxy = '' // Can be set to proxy URL if needed

  private constructor() {}

  static getInstance(): BibleService {
    if (!BibleService.instance)
      BibleService.instance = new BibleService()

    return BibleService.instance
  }

  /**
   * Fetch Bible data with CORS handling
   */
  async fetchBibleData(version: string): Promise<BibleData> {
    const cacheKey = `bible_${version}`

    // Check IndexedDB cache first
    const cached = await this.getFromCache(cacheKey)
    if (cached)
      return cached

    try {
      const baseUrl = 'https://bible-api.com'
      const url = `${baseUrl}/${version}`

      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      })

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`)

      const data = await response.json()

      // Cache the response
      await this.cacheData(cacheKey, data)

      return data
    }
    catch (error) {
      console.error('Failed to fetch Bible data:', error)

      // Try fallback URLs or cached data
      const fallbackData = await this.getFallbackData(version)
      if (fallbackData)
        return fallbackData

      throw new Error(`Unable to load Bible data for ${version}`)
    }
  }

  /**
   * Get data from IndexedDB cache
   */
  private async getFromCache(key: string): Promise<BibleData | null> {
    try {
      const db = await this.openDatabase()
      const transaction = db.transaction(['bibleData'], 'readonly')
      const store = transaction.objectStore('bibleData')
      const request = store.get(key)

      return new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result?.data || null)
        request.onerror = () => resolve(null)
      })
    }
    catch {
      return null
    }
  }

  /**
   * Cache data in IndexedDB
   */
  private async cacheData(key: string, data: BibleData): Promise<void> {
    try {
      const db = await this.openDatabase()
      const transaction = db.transaction(['bibleData'], 'readwrite')
      const store = transaction.objectStore('bibleData')
      store.put({ key, data, timestamp: Date.now() })
    }
    catch (error) {
      console.warn('Failed to cache data:', error)
    }
  }

  /**
   * Open IndexedDB database
   */
  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('BibleAppDB', 1)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('bibleData'))
          db.createObjectStore('bibleData', { keyPath: 'key' })
      }
    })
  }

  /**
   * Get cached data as fallback
   */
  private async getFallbackData(version: string): Promise<BibleData | null> {
    try {
      return await this.getFromCache(`bible_${version}`)
    }
    catch {
      return null
    }
  }
}

// Create and export a singleton instance
export const bibleService = BibleService.getInstance()
