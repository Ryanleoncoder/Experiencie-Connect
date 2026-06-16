function avatarMetaDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

/**
 * Avatar Metadata Loader Component
 *
 * Loads and manages avatar metadata from JSON configuration.
 * Provides fallback to filename-based names when metadata is unavailable.
 *
 * Features:
 * - 3-second timeout for JSON loading
 * - In-memory caching for loaded metadata
 * - Graceful fallback to filename-based names
 * - AbortController for request cancellation
 */

class AvatarMetadataLoader {
  constructor() {
    this.metadata = null;
    this.loaded = false;
    this.loading = false;
    this.loadPromise = null;
  }

  /**
   * Loads avatar metadata from JSON configuration file
   * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
   */
  async load() {
    if (this.loaded) {
      return { success: true, data: this.metadata, error: null };
    }

    if (this.loading && this.loadPromise) {
      return this.loadPromise;
    }

    this.loading = true;

    this.loadPromise = this._performLoad();

    const result = await this.loadPromise;

    this.loading = false;
    this.loadPromise = null;

    return result;
  }

  /**
   * Internal method to perform the actual load operation
   * @private
   */
  async _performLoad() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch('/frontend/assets/data/avatars.json', {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data || typeof data !== 'object') {
        throw new Error('Invalid metadata format: expected object');
      }

      // Cache the metadata
      this.metadata = data;
      this.loaded = true;

      avatarMetaDebugLog('[AvatarMetadataLoader] Metadata loaded successfully');
      return { success: true, data: this.metadata, error: null };

    } catch (error) {
      clearTimeout(timeoutId);

      let errorMessage = 'Unknown error';

      if (error.name === 'AbortError') {
        errorMessage = 'Timeout: metadata load exceeded 3 seconds';
        console.warn('[AvatarMetadataLoader] Timeout loading metadata, using fallback');
      } else {
        errorMessage = error.message || 'Failed to load metadata';
        console.error('[AvatarMetadataLoader] Error loading metadata:', error);
      }

      this.loaded = true;
      this.metadata = null;

      return { success: false, data: null, error: errorMessage };
    }
  }

  /**
   * Gets avatar information for a given filename
   * @returns {{name: string, description: string}} Avatar info with fallback
   */
  getAvatarInfo(filename) {
    if (this.metadata && this.metadata[filename]) {
      return {
        name: this.metadata[filename].name || this._getFilenameBasedName(filename),
        description: this.metadata[filename].description || ''
      };
    }

    // Fallback to filename-based name
    return {
      name: this._getFilenameBasedName(filename),
      description: ''
    };
  }

  /**
   * Generates a name from filename by removing extension
   * @returns {string} Name without extension
   * @private
   */
  _getFilenameBasedName(filename) {
    if (!filename || typeof filename !== 'string') {
      return 'Avatar';
    }

    return filename.replace(/\.[^.]+$/, '');
  }

  /**
   * Checks if metadata has been loaded
   * @returns {boolean} True if metadata is loaded
   */
  isLoaded() {
    return this.loaded;
  }

  /**
   * Gets the raw metadata object
   * @returns {object|null} The metadata object or null if not loaded
   */
  getMetadata() {
    return this.metadata;
  }

  /**
   * Clears the cached metadata and resets state
   */
  clear() {
    this.metadata = null;
    this.loaded = false;
    this.loading = false;
    this.loadPromise = null;
    avatarMetaDebugLog('[AvatarMetadataLoader] Cache cleared');
  }
}

// Export for global use
if (typeof window !== 'undefined') {
  window.AvatarMetadataLoader = AvatarMetadataLoader;
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AvatarMetadataLoader;
}
