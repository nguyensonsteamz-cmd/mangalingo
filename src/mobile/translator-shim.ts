import { installTranslatorShim } from './ios';
import { installAndroidTranslatorShim } from './native';

// Apple Translation (iPhone) / ML Kit (Android) as the `Translator` API – before the UI modules read it
installTranslatorShim();
installAndroidTranslatorShim();
