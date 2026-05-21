import { Profession } from '@prisma/client';

export interface LeadInput {
  profession?: Profession | string | null;
  whatsapp?: string;
  whatsappValid?: boolean | null;
  partnerOrOwner?: boolean | null;
  yearsOfPractice?: number | null;
  googleRating?: number | any | null;
  googleReviewsCount?: number | null;
  address?: {
    neighborhood?: string;
    city?: string;
  } | any;
  metadata?: any;
  
  // Penalty flags for skip logic
  alreadyApproachedLast90Days?: boolean;
  isActiveClient?: boolean;
  isOptout?: boolean;
}

export interface CampaignFilters {
  min_fit_score?: number;
  [key: string]: any;
}

export interface CampaignInput {
  profession: Profession | string;
  filters?: CampaignFilters | any;
}

export function calculateFitScore(
  lead: LeadInput,
  campaign: CampaignInput,
  tenant: { highValueAreas: string[] }
): number {
  // 1. Critical penalties that trigger immediate skip (-Infinity)
  if (lead.alreadyApproachedLast90Days) {
    return -Infinity;
  }
  if (lead.isActiveClient) {
    return -Infinity;
  }
  if (lead.isOptout) {
    return -Infinity;
  }

  let score = 0;

  // 2. Component: matches_target_profession (+3.0) & penalty if not matching (-5.0)
  if (lead.profession && lead.profession === campaign.profession) {
    score += 3.0;
  } else {
    score -= 5.0;
  }

  // 3. Component: whatsapp_valid (+2.0)
  if (lead.whatsappValid === true) {
    score += 2.0;
  }

  // 4. Component: is_owner_or_partner (+2.0)
  const isOwner = lead.partnerOrOwner === true || 
                  lead.metadata?.is_owner === true || 
                  lead.metadata?.is_partner === true || 
                  lead.metadata?.partner_or_owner === true;
  if (isOwner) {
    score += 2.0;
  }

  // 5. Component: high_value_area (+1.0)
  const neighborhood = lead.address?.neighborhood;
  if (neighborhood && tenant.highValueAreas) {
    const isHighValue = tenant.highValueAreas.some(
      (area) => area.toLowerCase().trim() === neighborhood.toLowerCase().trim()
    );
    if (isHighValue) {
      score += 1.0;
    }
  }

  // 6. Component: cnpj_age_score (0 - 1.0)
  const years = lead.yearsOfPractice || lead.metadata?.cnpj_age_years || 0;
  const cnpjAgeScore = Math.max(0, Math.min(years / 5, 1.0));
  score += cnpjAgeScore;

  // 7. Component: high_rating (+1.0)
  const rating = Number(lead.googleRating || lead.metadata?.google_rating || 0);
  const reviews = lead.googleReviewsCount || lead.metadata?.google_reviews_count || 0;
  if (rating >= 4.5 && reviews >= 10) {
    score += 1.0;
  }

  // Cap the score between 0.0 and 10.0
  return Math.max(0, Math.min(10.0, score));
}
