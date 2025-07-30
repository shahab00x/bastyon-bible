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
    }, 500)
  }
}

function handleTouchMove(event: TouchEvent, index: number) {
  if (!touchStartX.value || !touchStartY.value)
    return

  const touchX = event.touches[0].clientX
  const touchY = event.touches[0].clientY

  const deltaX = touchStartX.value - touchX
  const deltaY = Math.abs(touchStartY.value - touchY)

  // Clear long press timer if movement detected
  if (Math.abs(deltaX) > 10 || deltaY > 10) {
    if (longPressTimer.value) {
      clearTimeout(longPressTimer.value)
      longPressTimer.value = null
    }
  }

  if (isMobile.value && isDragging.value && draggedItem.value !== null) {
    // Mobile swipe-to-delete
    swipeOffset.value[index] = Math.max(0, deltaX)
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
      if (Math.abs(deltaX) > 50 && deltaY < 30 && deltaX > 0) {
        removeFromClipboard(index)
      }
      else {
        // Reset swipe offset
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
            :data-clipboard-index="index"
            @dragstart="!isMobile && handleDragStart(index)"
            @dragover="!isMobile && handleDragOver($event, index)"
            @drop="!isMobile && handleDrop(index)"
            @dragend="!isMobile && handleDragEnd"
            @touchstart.passive="handleTouchStart($event, index)"
            @touchmove.passive="handleTouchMove($event, index)"
            @touchend.passive="handleTouchEnd($event, index)"
          >
            <!-- Desktop drag handle -->
            <div v-if="!isMobile" class="drag-handle desktop" title="Drag to reorder">
              ⋮⋮
            </div>

            <!-- Mobile drag handle -->
            <div v-if="isMobile" class="drag-handle mobile" title="Long press to drag">
              <div class="drag-dots">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>

            <div class="clipboard-content">
              <p class="clipboard-text">
                {{ verse.text }}
              </p>
            </div>

            <!-- Desktop remove button -->
            <button
              v-if="!isMobile"
              class="desktop clipboard-remove-btn"
              title="Remove verse"
              @click="removeFromClipboard(index)"
            >
              ✕
            </button>

            <!-- Mobile swipe delete overlay -->
            <div v-if="isMobile" class="mobile-delete-overlay" :style="{ transform: `translateX(${swipeOffset[index] || 0}px)` }">
              <div class="delete-action" @click="removeFromClipboard(index)">
                <span>Delete</span>
              </div>
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
  align-items: flex-start;
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
  top: 0;
  right: 0;
  padding: 1rem;
  background: #ffffff;
  border: 2px solid #0066cc;
  border-radius: 0 0 0 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  z-index: 1000;
}

.clipboard-btn {
  background: #0066cc;
  border: none;
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  cursor: pointer;
  transition: background 0.3s;
  font-weight: 500;
  font-size: 0.9rem;
}

.clipboard-btn:hover {
  background: #0052a3;
}

.clipboard-panel {
  margin-top: 1rem;
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #0066cc;
  border-radius: 8px;
  max-width: 300px;
  overflow-y: auto;
  max-height: 300px;
}

.clipboard-title {
  color: #000000;
  font-weight: bold;
  font-size: 1.1rem;
  margin: 0 0 0.5rem 0;
}

.clipboard-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.clipboard-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  color: #000000;
  transition: border-top 0.2s ease;
  position: relative;
  touch-action: pan-y;
}

.clipboard-item.dragging {
  opacity: 0.7;
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.clipboard-item.mobile-view:active {
  transform: scale(0.98);
}

.clipboard-item[data-swipe-start='true'] {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.clipboard-text {
  color: #000000;
  margin: 0;
  flex: 1;
  padding: 0 0.5rem;
}

.clipboard-remove-btn {
  background: #ff4444;
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
}

.clipboard-remove-btn:hover {
  background: #cc0000;
}

.drag-handle {
  cursor: move;
  padding: 0 0.5rem;
  color: #0066cc;
  font-size: 1.2rem;
  font-weight: bold;
  user-select: none;
  flex-shrink: 0;
}

.drag-handle.desktop {
  display: block;
}

.drag-handle.desktop:hover {
  background: rgba(0, 102, 204, 0.1);
  border-radius: 4px;
}

.drag-handle.mobile {
  cursor: grab;
  padding: 0.5rem;
  color: #666;
  user-select: none;
  flex-shrink: 0;
  display: none;
  margin-top: auto;
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

  .verse-content {
    flex-direction: column;
    align-items: flex-start;
  }

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
}
</style>
