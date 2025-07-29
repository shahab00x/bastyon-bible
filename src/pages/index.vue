<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface BibleBook {
  abbrev: string
  name: string
  chapters: string[][]
}

defineOptions({
  name: 'BibleApp',
})

const bibleData = ref<BibleBook[] | null>(null)
const selectedBook = ref<BibleBook | null>(null)
const selectedChapter = ref<string[] | null>(null)
const selectedChapterIndex = ref<number | null>(null)
const isLoading = ref(true)
const loadProgress = ref(0)
const searchQuery = ref('')
const currentView = ref<'books' | 'chapter' | 'verse'>('books')
const copiedVerse = ref<{ book: string, chapter: number, verse: number } | null>(null)

// No internal mapping needed since name and abbrev are in the JSON

// Load Bible data from JSON
onMounted(async () => {
  try {
    const response = await fetch('/en_kjv.json')
    const reader = response.body.getReader()
    const contentLength = response.headers.get('Content-Length')
    let receivedLength = 0
    const chunks = []

    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      chunks.push(value)
      receivedLength += value.length
      const progress = (receivedLength / Number.parseInt(contentLength!)) * 100
      loadProgress.value = Math.floor(progress)
    }

    const chunksAll = new Uint8Array(receivedLength)
    let position = 0
    for (const chunk of chunks) {
      chunksAll.set(chunk, position)
      position += chunk.length
    }

    const result = new TextDecoder('utf-8').decode(chunksAll)
    bibleData.value = JSON.parse(result)
    isLoading.value = false
  }
  catch (error) {
    console.error('Failed to load Bible data:', error)
    isLoading.value = false
  }
})

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
  navigator.clipboard.writeText(textToCopy)
  copiedVerse.value = { book: book.abbrev, chapter: chapterIndex, verse: verseIndex }
  setTimeout(() => {
    copiedVerse.value = null
  }, 2000)
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
        <p class="app-subtitle">
          King James Version
        </p>
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

.app-footer {
  text-align: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.2);
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
