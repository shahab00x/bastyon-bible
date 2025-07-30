<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface BibleBook {
  abbrev: string
  name: string
  chapters: string[][]
}

interface BibleVersion {
  id: string
  name: string
  fileName: string
}

defineOptions({
  name: 'BibleApp',
})

// Define available Bible versions
const BIBLE_VERSIONS: BibleVersion[] = [
  { id: 'en-kjv', name: 'English - KJV Bible', fileName: 'en_kjv.json' },
  { id: 'ru-synodal', name: 'Russian - Synodal Bible', fileName: 'ru_synodal.json' },
]

// Reactive state
const bibleData = ref<BibleBook[] | null>(null)
const selectedBook = ref<BibleBook | null>(null)
const selectedChapter = ref<string[] | null>(null)
const selectedChapterIndex = ref<number | null>(null)
const isLoading = ref(true)
const isDownloading = ref(false)
const loadProgress = ref(0)
const searchQuery = ref('')
const currentView = ref<'books' | 'chapter' | 'verse'>('books')
const copiedVerse = ref<{ book: string, chapter: number, verse: number } | null>(null)
const selectedVersion = ref<BibleVersion | null>(null)
const clipboardVerses = ref<Array<{ text: string, book: string, chapter: number, verse: number, id: string }>>([])
const showClipboardRibbon = ref(false)
const isClipboardOpen = ref(false)
const draggedItem = ref<number | null>(null)
const touchStartX = ref<number>(0)
const touchStartY = ref<number>(0)
const isMobile = ref(false)
const swipeOffset = ref<Record<number, number>>({})
const longPressTimer = ref<number | null>(null)
const isDragging = ref(false)

// Computed property for tracking if user has selected a version
const hasUserSelectedVersion = computed(() => {
  return selectedVersion.value !== null
})

function showDeleteOverlay(index: number) {
  return isMobile.value && (swipeOffset.value[index] || 0) < -30 // Show earlier for better feedback
}

// Initialize with placeholder
onMounted(() => {
  const savedVersionId = localStorage.getItem('bibleVersion')
  if (savedVersionId) {
    const version = BIBLE_VERSIONS.find(v => v.id === savedVersionId)
    if (version) {
      selectedVersion.value = version
      loadBibleData(version)
    }
  }
  else {
    // No saved version, show placeholder
    isLoading.value = false
  }
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

// IndexedDB setup for caching large Bible files
const DB_NAME = 'BibleAppDB'
const DB_VERSION = 1
const STORE_NAME = 'bibleCache'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
  })
}

async function getCachedBible(versionId: string): Promise<BibleBook[] | null> {
  try {
    const db = await openDB()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(versionId)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result ? request.result.data : null)
      }
      request.onerror = () => reject(request.error)
    })
  }
  catch (error) {
    console.error('Failed to get cached Bible from IndexedDB:', error)
    return null
  }
}

async function cacheBible(versionId: string, data: BibleBook[]): Promise<void> {
  try {
    const db = await openDB()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.put({ id: versionId, data })
  }
  catch (error) {
    console.error('Failed to cache Bible in IndexedDB:', error)
  }
}

// Load Bible data from JSON
async function loadBibleData(version: BibleVersion): Promise<void> {
  try {
    isDownloading.value = true
    loadProgress.value = 0

    // Check if we have cached data in IndexedDB
    const cachedData = await getCachedBible(version.id)
    if (cachedData) {
      bibleData.value = cachedData
      isLoading.value = false
      isDownloading.value = false
      return
    }

    const response = await fetch(`/${version.fileName}`)
    if (!response.body)
      throw new Error('Response body is null')

    const reader = response.body.getReader()
    const contentLength = response.headers.get('Content-Length')
    const totalLength = contentLength ? Number.parseInt(contentLength) : 0
    let receivedLength = 0
    const chunks = []

    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      chunks.push(value)
      receivedLength += value.length

      // Calculate progress even without Content-Length
      if (totalLength > 0) {
        const progress = (receivedLength / totalLength) * 100
        loadProgress.value = Math.floor(progress)
      }
      else {
        // Fallback: show incremental progress based on chunks received
        loadProgress.value = Math.min(95, Math.floor(receivedLength / 10000)) // Approximate progress
      }
    }

    const chunksAll = new Uint8Array(receivedLength)
    let position = 0
    for (const chunk of chunks) {
      chunksAll.set(chunk, position)
      position += chunk.length
    }

    const result = new TextDecoder('utf-8').decode(chunksAll)
    const parsedData = JSON.parse(result)

    // Cache the data in IndexedDB
    await cacheBible(version.id, parsedData)

    bibleData.value = parsedData
    isLoading.value = false
    isDownloading.value = false
    loadProgress.value = 100 // Ensure it reaches 100%
  }
  catch (error) {
    console.error('Failed to load Bible data:', error)
    isLoading.value = false
    isDownloading.value = false
    loadProgress.value = 0
    throw error
  }
}

// Handle version change
function handleVersionChange(versionId: string) {
  const version = BIBLE_VERSIONS.find(v => v.id === versionId)
  if (version) {
    selectedVersion.value = version
    localStorage.setItem('bibleVersion', version.id)
    bibleData.value = null
    isLoading.value = true

    // Store current view state for potential restoration
    const wasViewingChapter = currentView.value === 'verse' && selectedBook.value && selectedChapterIndex.value !== null
    const currentBook = selectedBook.value
    const currentChapterIndex = selectedChapterIndex.value

    loadBibleData(version).then(() => {
      // If user was viewing a chapter, reload it
      if (wasViewingChapter && currentBook && currentChapterIndex !== null) {
        const newBook = bibleData.value?.find(book => book.name === currentBook.name)
        if (newBook && newBook.chapters[currentChapterIndex]) {
          selectedBook.value = newBook
          selectedChapter.value = newBook.chapters[currentChapterIndex]
          selectedChapterIndex.value = currentChapterIndex
          currentView.value = 'verse'
        }
        else {
          // Fallback to books view if chapter not found
          currentView.value = 'books'
          selectedBook.value = null
          selectedChapter.value = null
          selectedChapterIndex.value = null
        }
      }
      else {
        // Reset to books view for other cases
        currentView.value = 'books'
        selectedBook.value = null
        selectedChapter.value = null
        selectedChapterIndex.value = null
      }
    })
  }
}

// Filter books based on search query
const filteredBooks = computed(() => {
  if (!bibleData.value)
    return bibleData.value || []

  const query = searchQuery.value.toLowerCase()
  if (!query)
    return bibleData.value

  return bibleData.value.filter(book =>
    (book.name.toLowerCase().includes(query)
      || book.abbrev.toLowerCase().includes(query)),
  )
})

// Navigation functions
function selectBook(book: BibleBook) {
  selectedBook.value = book
  selectedChapter.value = null
  selectedChapterIndex.value = null
  currentView.value = 'chapter'
  window.scrollTo(0, 0)
}

function selectChapter(chapterIndex: number) {
  selectedChapterIndex.value = chapterIndex
  selectedChapter.value = selectedBook.value?.chapters[chapterIndex] || null
  currentView.value = 'verse'
  window.scrollTo(0, 0)
}

function goBack() {
  if (currentView.value === 'verse') {
    currentView.value = 'chapter'
    selectedChapter.value = null
    selectedChapterIndex.value = null
  }
  else if (currentView.value === 'chapter') {
    currentView.value = 'books'
    selectedChapter.value = null
    selectedChapterIndex.value = null
    selectedBook.value = null
  }
  window.scrollTo(0, 0)
}

function copyVerse(book: BibleBook, chapterIndex: number, verseIndex: number, verseText: string) {
  const textToCopy = `${verseText} - ${book.name} ${chapterIndex + 1}:${verseIndex + 1}`
  const verseId = `${book.abbrev}-${chapterIndex}-${verseIndex}-${Date.now()}`

  // Add to clipboard array
  clipboardVerses.value.push({
    text: textToCopy,
    book: book.abbrev,
    chapter: chapterIndex,
    verse: verseIndex,
    id: verseId,
  })

  // Update system clipboard with all verses
  updateSystemClipboard()

  // Show ribbon
  showClipboardRibbon.value = true

  // Keep existing feedback
  copiedVerse.value = { book: book.abbrev, chapter: chapterIndex, verse: verseIndex }
  setTimeout(() => {
    copiedVerse.value = null
  }, 2000)
}

function updateSystemClipboard() {
  const allText = clipboardVerses.value.map(v => v.text).join('\n')
  navigator.clipboard.writeText(allText)
}

function removeFromClipboard(index: number) {
  clipboardVerses.value.splice(index, 1)
  updateSystemClipboard()

  // Reset all swipe offsets to prevent items from staying swiped
  swipeOffset.value = {}

  // Hide ribbon if empty
  if (clipboardVerses.value.length === 0) {
    showClipboardRibbon.value = false
    isClipboardOpen.value = false
  }
}

function reorderVerses(fromIndex: number, toIndex: number) {
  const verse = clipboardVerses.value.splice(fromIndex, 1)[0]
  clipboardVerses.value.splice(toIndex, 0, verse)
  updateSystemClipboard()
}

function toggleClipboard() {
  isClipboardOpen.value = !isClipboardOpen.value
}

function goToNextChapter() {
  if (selectedBook.value && selectedChapterIndex.value !== null) {
    const nextChapterIndex = selectedChapterIndex.value + 1
    if (nextChapterIndex < selectedBook.value.chapters.length)
      selectChapter(nextChapterIndex)
  }
}

function goToPreviousChapter() {
  if (selectedBook.value && selectedChapterIndex.value !== null) {
    const prevChapterIndex = selectedChapterIndex.value - 1
    if (prevChapterIndex >= 0)
      selectChapter(prevChapterIndex)
  }
}

function handleDragStart(index: number) {
  draggedItem.value = index
}

function handleDragOver(event: DragEvent, _index: number) {
  event.preventDefault()
}

function handleDrop(index: number) {
  if (draggedItem.value !== null) {
    reorderVerses(draggedItem.value, index)
    draggedItem.value = null
  }
}

function handleDragEnd() {
  draggedItem.value = null
}

function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}

function handleTouchStart(event: TouchEvent, index: number) {
  touchStartX.value = event.touches[0].clientX
  touchStartY.value = event.touches[0].clientY

  if (isMobile.value) {
    // Start long press timer for drag initiation
    longPressTimer.value = window.setTimeout(() => {
      draggedItem.value = index
      isDragging.value = true

      const target = event.target as HTMLElement
      const item = target.closest('.clipboard-item')
      if (item) {
        const htmlItem = item as HTMLElement
        htmlItem.style.opacity = '0.7'
        htmlItem.style.transform = 'scale(1.02)'
      }
    }, 300) // Reduced from 500ms for better responsiveness
  }
}

function handleTouchMove(event: TouchEvent, index: number) {
  if (!touchStartX.value || !touchStartY.value)
    return

  const touchX = event.touches[0].clientX
  const touchY = event.touches[0].clientY

  const deltaX = touchStartX.value - touchX
  const deltaY = Math.abs(touchStartY.value - touchY)

  // Only handle horizontal swipes and prevent scrolling
  if (Math.abs(deltaX) > deltaY && Math.abs(deltaX) > 10) {
    event.preventDefault()

    // Only allow leftward swipes (deltaX > 0) and limit distance
    if (deltaX > 0 && isMobile.value)
      swipeOffset.value[index] = -Math.min(deltaX, 100)
  }

  // Clear long press timer if movement detected
  if (Math.abs(deltaX) > 10 || deltaY > 10) {
    if (longPressTimer.value) {
      clearTimeout(longPressTimer.value)
      longPressTimer.value = null
    }
  }
}

function handleTouchEnd(event: TouchEvent, index: number) {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }

  const touchEndX = event.changedTouches[0].clientX
  const touchEndY = event.changedTouches[0].clientY

  const deltaX = touchStartX.value - touchEndX
  const deltaY = Math.abs(touchStartY.value - touchEndY)

  // Reset styles
  const target = event.target as HTMLElement
  const item = target.closest('.clipboard-item')
  if (item) {
    const htmlItem = item as HTMLElement
    htmlItem.style.opacity = ''
    htmlItem.style.transform = ''
  }

  if (isMobile.value) {
    if (isDragging.value && draggedItem.value !== null) {
      // End drag mode
      isDragging.value = false
      draggedItem.value = null
    }
    else if (!isDragging.value) {
      // Handle swipe-to-delete
      if (Math.abs(deltaX) > 100 && deltaY < 30 && deltaX > 0) {
        // Swipe threshold met - delete the item
        removeFromClipboard(index)
      }
      else {
        // Snap back - reset swipe offset with animation
        swipeOffset.value[index] = 0
      }
    }
  }

  touchStartX.value = 0
  touchStartY.value = 0
}
</script>

<template>
  <div class="bible-app">
    <!-- Header -->
    <header class="bible-header">
      <div class="header-content">
        <h1 class="app-title">
          <span class="icon">📖</span>
          Holy Bible
        </h1>
        <div class="version-selector">
          <select
            :value="selectedVersion?.id || ''"
            class="version-dropdown"
            :disabled="isDownloading"
            @change="handleVersionChange(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-if="!hasUserSelectedVersion"
              value=""
            >
              Select a version
            </option>
            <option
              v-for="version in BIBLE_VERSIONS"
              :key="version.id"
              :value="version.id"
            >
              {{ version.name }}
            </option>
          </select>
        </div>

        <!-- Progress bar -->
        <div v-if="isDownloading" class="progress-container">
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: `${loadProgress}%` }"
            />
          </div>
          <p class="progress-text">
            Loading... {{ loadProgress }}%
          </p>
        </div>
      </div>
    </header>

    <!-- Navigation -->
    <nav v-if="currentView !== 'books'" class="breadcrumb-nav">
      <button class="back-btn" @click="goBack">
        ← Back
      </button>
      <span class="breadcrumb">
        {{ selectedBook?.name }}
        <span v-if="selectedChapterIndex !== null"> - Chapter {{ selectedChapterIndex + 1 }}</span>
      </span>
    </nav>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-state">
      <div class="spinner" />
      <p>Loading Bible...</p>
      <div class="progress-container">
        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: `${loadProgress}%` }"
          />
        </div>
        <p class="progress-text">
          {{ loadProgress }}% Complete
        </p>
      </div>
    </div>

    <!-- Books View -->
    <div v-else-if="currentView === 'books'" class="books-view">
      <div class="search-section">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search books..."
          class="search-input"
        >
      </div>

      <div class="books-grid">
        <div
          v-for="book in filteredBooks"
          :key="book.abbrev"
          class="book-card"
          @click="selectBook(book)"
        >
          <h3 class="book-name">
            {{ book.abbrev.toUpperCase() }}
          </h3>
          <p class="book-abbr">
            {{ book.name }}
          </p>
          <p class="book-chapters">
            {{ book.chapters.length }} chapters
          </p>
        </div>
      </div>
    </div>

    <!-- Chapter View -->
    <div v-else-if="currentView === 'chapter' && selectedBook" class="chapter-view">
      <div class="chapters-grid">
        <div
          v-for="(chapter, chapterIndex) in selectedBook.chapters"
          :key="chapterIndex"
          class="chapter-card"
          @click="selectChapter(chapterIndex)"
        >
          <h3 class="chapter-number">
            Chapter {{ chapterIndex + 1 }}
          </h3>
          <p class="chapter-verses">
            {{ chapter.length }} verses
          </p>
        </div>
      </div>
    </div>

    <!-- Verse View -->
    <div v-else-if="currentView === 'verse' && selectedChapter" class="verse-view">
      <div class="chapter-navigation-top">
        <button
          v-if="selectedChapterIndex !== null && selectedChapterIndex > 0"
          class="nav-btn"
          @click="goToPreviousChapter"
        >
          ← Previous Chapter
        </button>
        <span class="chapter-title">{{ selectedBook?.name }} {{ selectedChapterIndex !== null ? selectedChapterIndex + 1 : '' }}</span>
        <button
          v-if="selectedBook && selectedChapterIndex !== null && selectedChapterIndex < selectedBook.chapters.length - 1"
          class="nav-btn"
          @click="goToNextChapter"
        >
          Next Chapter →
        </button>
      </div>

      <div class="verses-list">
        <div
          v-for="(verseText, verseIndex) in selectedChapter"
          :key="verseIndex"
          class="verse-card"
        >
          <div class="verse-content">
            <span class="verse-number">{{ verseIndex + 1 }}</span>
            <p class="verse-text">
              {{ verseText }}
            </p>
            <button
              class="copy-btn"
              title="Copy verse"
              :class="{ copied: copiedVerse && copiedVerse.book === selectedBook?.abbrev && copiedVerse.chapter === selectedChapterIndex && copiedVerse.verse === verseIndex }"
              @click="copyVerse(selectedBook!, selectedChapterIndex!, verseIndex, verseText)"
            >
              {{ copiedVerse && copiedVerse.book === selectedBook?.abbrev && copiedVerse.chapter === selectedChapterIndex && copiedVerse.verse === verseIndex ? '✓' : '📋' }}
            </button>
          </div>
        </div>
      </div>

      <div class="chapter-navigation-bottom">
        <button
          v-if="selectedChapterIndex !== null && selectedChapterIndex > 0"
          class="nav-btn"
          @click="goToPreviousChapter"
        >
          ← Previous Chapter
        </button>
        <button
          v-if="selectedBook && selectedChapterIndex !== null && selectedChapterIndex < selectedBook.chapters.length - 1"
          class="nav-btn next-chapter-btn"
          @click="goToNextChapter"
        >
          Next Chapter →
        </button>
      </div>
    </div>

    <!-- Clipboard Ribbon -->
    <div v-if="showClipboardRibbon" class="clipboard-ribbon">
      <button class="clipboard-btn" @click="toggleClipboard">
        {{ isClipboardOpen ? 'Hide Clipboard' : `Clipboard (${clipboardVerses.length})` }}
      </button>
      <div v-if="isClipboardOpen" class="clipboard-panel">
        <h3 class="clipboard-title">
          Copied Verses
        </h3>
        <ul class="clipboard-list">
          <li
            v-for="(verse, index) in clipboardVerses"
            :key="verse.id"
            class="clipboard-item"
            :class="{ 'dragging': draggedItem === index, 'mobile-view': isMobile }"
            :draggable="!isMobile"
            @dragstart="!isMobile && handleDragStart(index)"
            @dragover="!isMobile && handleDragOver($event, index)"
            @drop="!isMobile && handleDrop(index)"
            @dragend="!isMobile && handleDragEnd"
            @touchstart.passive="handleTouchStart($event, index)"
            @touchmove="handleTouchMove($event, index)"
            @touchend.passive="handleTouchEnd($event, index)"
          >
            <!-- Delete overlay (appears behind) - MOBILE ONLY -->
            <div
              v-if="isMobile && showDeleteOverlay(index)"
              class="mobile-delete-overlay"
              :class="{ show: Math.abs(swipeOffset[index] || 0) > 60 }"
            >
              <div class="delete-action" @click="removeFromClipboard(index)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span class="delete-text">Delete</span>
              </div>
            </div>

            <!-- Main content (appears on top) -->
            <div
              class="clipboard-content"
              :style="isMobile ? { transform: `translateX(${Math.min(0, swipeOffset[index] || 0)}px)` } : {}"
            >
              <!-- Desktop drag handle -->
              <div v-if="!isMobile" class="drag-handle desktop" title="Drag to reorder">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="9" cy="5" r="1" />
                  <circle cx="9" cy="12" r="1" />
                  <circle cx="9" cy="19" r="1" />
                  <circle cx="15" cy="5" r="1" />
                  <circle cx="15" cy="12" r="1" />
                  <circle cx="15" cy="19" r="1" />
                </svg>
              </div>

              <!-- Mobile drag handle -->
              <div v-if="isMobile" class="drag-handle mobile" title="Swipe left to delete">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="9" cy="5" r="1" />
                  <circle cx="9" cy="12" r="1" />
                  <circle cx="9" cy="19" r="1" />
                  <circle cx="15" cy="5" r="1" />
                  <circle cx="15" cy="12" r="1" />
                  <circle cx="15" cy="19" r="1" />
                </svg>
              </div>

              <p class="clipboard-text">
                {{ verse.text }}
              </p>

              <!-- Desktop remove button - RED X -->
              <button
                v-if="!isMobile"
                class="clipboard-remove-btn"
                title="Remove verse"
                style="background-color: #dc2626; color: white;"
                @click="removeFromClipboard(index)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Footer -->
    <footer class="app-footer">
      <p>📖 Holy Bible App</p>
      <p class="footer-note">
        Developed by <a href="https://bastyon.com/shahab">Shahab</a>
      </p>
    </footer>
  </div>
</template>

<style scoped>
.bible-app {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

/* Hide Bastyon SDK GitHub button */
.bastyon-github-button,
.github-button,
[data-bastyon='github'],
[class*='github'][class*='button'],
#github-button {
  display: none !important;
}

/* Hide any Bastyon SDK buttons if they have a common parent */
.bastyon-sdk-buttons,
.bastyon-social-buttons {
  display: none !important;
}

.bible-header {
  background: rgba(0, 0, 0, 0.2);
  padding: 2rem 1rem;
  text-align: center;
}

.app-title {
  font-size: 2.5rem;
  font-weight: bold;
  margin: 0;
}

.app-subtitle {
  opacity: 0.8;
  margin: 0.5rem 0 0 0;
}

.version-selector {
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.version-dropdown {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-size: 1rem;
  outline: none;
  cursor: pointer;
  width: 100%;
  max-width: 300px;
}

.version-dropdown:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.version-dropdown option {
  background: #667eea;
  color: white;
}

.progress-container {
  width: 100%;
  max-width: 300px;
  margin: 1rem auto;
}

.progress-bar {
  height: 10px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4facfe 0%, #00f2fe 100%);
  transition: width 0.3s ease;
}

.progress-text {
  text-align: center;
  margin: 0.5rem 0 0 0;
  font-size: 0.9rem;
  opacity: 0.8;
}

.breadcrumb-nav {
  display: flex;
  align-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.1);
  gap: 1rem;
}

.back-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  cursor: pointer;
  transition: background 0.3s;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.breadcrumb {
  font-weight: 500;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top: 4px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.progress-container {
  margin-top: 1rem;
}

.progress-bar {
  width: 100%;
  height: 10px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: white;
  border-radius: 10px 0 0 10px;
  transition: width 0.3s;
}

.progress-text {
  margin-top: 0.5rem;
  font-size: 0.9rem;
}

.search-section {
  padding: 1rem;
}

.search-input {
  width: 100%;
  padding: 0.75rem;
  border: none;
  border-radius: 25px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  font-size: 1rem;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.7);
}

.books-grid,
.chapters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  padding: 1rem;
}

.book-card,
.chapter-card {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 1.5rem;
  text-align: center;
  cursor: pointer;
  transition:
    transform 0.3s,
    background 0.3s;
}

.book-card:hover,
.chapter-card:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.2);
}

.book-name,
.chapter-number {
  font-size: 1.2rem;
  font-weight: bold;
  margin: 0 0 0.5rem 0;
}

.book-abbr,
.book-chapters,
.chapter-verses {
  opacity: 0.8;
  margin: 0;
}

.verse-view {
  padding: 1rem;
}

.chapter-navigation-top,
.chapter-navigation-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 1rem 0;
  padding: 0.5rem;
}

.chapter-navigation-top {
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.chapter-navigation-bottom {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  margin-top: 2rem;
}

.chapter-title {
  font-weight: bold;
  font-size: 1.2rem;
}

.nav-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  cursor: pointer;
  transition: background 0.3s;
  font-weight: 500;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.next-chapter-btn {
  margin-left: auto;
}

.verses-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.verse-card {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 1.5rem;
}

.verse-content {
  display: flex;
  flex-direction: row; /* Change from column to row */
  align-items: flex-start; /* Keep top alignment */
  gap: 1rem;
  margin-bottom: 0.5rem;
  text-align: left;
}

.verse-number {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  flex-shrink: 0;
}

.verse-text {
  flex: 1;
  margin: 0;
  line-height: 1.6;
  text-align: left;
}

.copy-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.3s;
}

.copy-btn:hover {
  opacity: 1;
}

.copy-btn.copied {
  opacity: 1;
  color: #34c759;
}

.clipboard-ribbon {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.clipboard-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 30px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  position: relative;
  overflow: hidden;
}

.clipboard-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.2),
    transparent
  );
  transition: left 0.5s;
}

.clipboard-btn:hover::before {
  left: 100%;
}

.clipboard-btn:hover {
  transform: translateY(-3px) scale(1.05);
  box-shadow: 0 12px 35px rgba(102, 126, 234, 0.4);
}

.clipboard-btn:active {
  transform: translateY(-1px) scale(1.02);
}

.clipboard-panel {
  position: absolute;
  bottom: 70px;
  right: 0;
  width: 320px;
  max-height: 450px;
  background: white;
  border-radius: 20px;
  box-shadow: 0 15px 50px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.05);
  animation: slideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  backdrop-filter: blur(10px);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.clipboard-title {
  padding: 20px;
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #2c3e50;
  border-bottom: 1px solid #f1f2f6;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  letter-spacing: -0.5px;
}

.clipboard-text {
  flex: 1; /* Take up remaining space */
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #2c3e50;
  word-break: break-word;
}

.clipboard-remove-btn {
  background-color: #dc2626;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0; /* Prevent button from shrinking */
  width: 32px;
  height: 32px;
}

.clipboard-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 350px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e0 #f7fafc;
}

.clipboard-list::-webkit-scrollbar {
  width: 6px;
}

.clipboard-list::-webkit-scrollbar-track {
  background: #f7fafc;
}

.clipboard-list::-webkit-scrollbar-thumb {
  background: #cbd5e0;
  border-radius: 3px;
}

.clipboard-list::-webkit-scrollbar-thumb:hover {
  background: #a0aec0;
}

.clipboard-item {
  position: relative;
  overflow: hidden;
  /* other existing styles */
}

.mobile-delete-overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 80px;
  background-color: #ef4444;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.mobile-delete-overlay.show {
  opacity: 1;
}

.clipboard-content {
  position: relative;
  z-index: 2;
  background: white;
  transition: transform 0.3s ease; /* Increased duration for smooth snap-back */
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 15px;
  padding: 15px 20px;
  /* other existing styles */
}

.clipboard-item:last-child {
  border-bottom: none;
}

.clipboard-item:hover {
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  transform: translateX(2px);
}

.clipboard-item.dragging {
  opacity: 0.8;
  transform: scale(1.02) rotate(2deg);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  z-index: 1000;
}

.clipboard-item.dragging .drag-handle {
  cursor: grabbing;
}

.drag-handle {
  cursor: grab;
  margin-right: 15px;
  color: #a0aec0;
  flex-shrink: 0;
  transition: all 0.3s ease;
  touch-action: none;
}

.drag-handle:hover {
  color: #667eea;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-dots {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 2px;
  width: 12px;
  height: 18px;
}

.drag-dots span {
  width: 3px;
  height: 3px;
  background-color: currentColor;
  border-radius: 50%;
  opacity: 0.6;
}

.drag-handle:hover .drag-dots span {
  opacity: 1;
}

.delete-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  cursor: pointer;
  padding: 0 1rem;
  gap: 4px;
}

.delete-text {
  font-size: 0.75rem;
  font-weight: 500;
}

.delete-action {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  cursor: pointer;
  padding: 0 1rem;
}

.delete-text {
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.footer-note {
  font-size: 0.9rem;
  opacity: 0.8;
}

@media (max-width: 768px) {
  .books-grid,
  .chapters-grid {
    grid-template-columns: 1fr;
  }

  /* .verse-content {
    flex-direction: column;
    align-items: flex-start;
  } */

  .chapter-navigation-top,
  .chapter-navigation-bottom {
    flex-direction: column;
    gap: 0.5rem;
  }

  .chapter-title {
    order: -1;
    margin-bottom: 0.5rem;
  }

  .next-chapter-btn {
    margin-left: 0;
  }

  /* Mobile clipboard ribbon positioning */
  .clipboard-ribbon {
    bottom: 15px;
    right: 15px;
    left: 15px;
    max-width: none;
  }

  .clipboard-panel {
    position: fixed;
    bottom: 80px;
    left: 15px;
    right: 15px;
    width: auto;
    max-width: none;
    max-height: 60vh;
  }

  .clipboard-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
