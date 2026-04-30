import * as ff from '@google-cloud/functions-framework';
import { handleReviewNotification } from './handlers/reviewNotification';
import { handlePollReviews } from './handlers/pollReviews';

ff.http('reviewNotification', handleReviewNotification);
ff.http('pollReviews', handlePollReviews);
