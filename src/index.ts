import * as ff from '@google-cloud/functions-framework';
import { handleReviewNotification } from './handlers/reviewNotification';

ff.http('reviewNotification', handleReviewNotification);
