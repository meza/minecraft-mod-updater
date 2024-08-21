package httpClient

import (
	"context"
	"fmt"
	"golang.org/x/time/rate"
	"net/http"
	"time"
)

type Doer interface {
	Do(request *http.Request) (*http.Response, error)
}

type RetryConfig struct {
	MaxRetries int
	Interval   time.Duration
}

type RLHTTPClient struct {
	client      *http.Client
	Ratelimiter *rate.Limiter
	RetryConfig *RetryConfig
}

func (client *RLHTTPClient) Do(request *http.Request) (*http.Response, error) {
	ctx := context.Background()
	retryConfig := RetryConfig{
		MaxRetries: 3,
		Interval:   1 * time.Second,
	}

	if client.RetryConfig != nil {
		retryConfig = *client.RetryConfig
	}

	var response *http.Response
	var err error

	for attempt := 0; attempt <= retryConfig.MaxRetries; attempt++ {
		err = client.Ratelimiter.Wait(ctx) // This is a blocking call. Honors the rate limit
		if err != nil {
			return nil, fmt.Errorf("rate limit burst exceeded %w", err)
		}

		response, err = client.client.Do(request)
		if err != nil {
			return nil, err
		}

		// Check if the response status is a server error (5xx)
		if response.StatusCode >= 500 && response.StatusCode < 600 {
			if attempt < retryConfig.MaxRetries {
				time.Sleep(retryConfig.Interval)
				continue
			}
		}

		// If the response is successful or a non-retryable error occurs, return the response or error
		break
	}

	return response, err
}

func NewRLClient(limiter *rate.Limiter) *RLHTTPClient {
	client := &RLHTTPClient{
		client:      http.DefaultClient,
		Ratelimiter: limiter,
	}
	return client
}

func NoRetries() *RetryConfig {
	return &RetryConfig{
		MaxRetries: 0,
		Interval:   0,
	}
}
