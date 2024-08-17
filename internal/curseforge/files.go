package curseforge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/meza/minecraft-mod-manager/internal/globalErrors"
	"github.com/meza/minecraft-mod-manager/internal/httpClient"
	"github.com/meza/minecraft-mod-manager/internal/models"
	"github.com/pkg/errors"
	"net/http"
	"runtime/trace"
	"strconv"
)

type getFilesResponse struct {
	Data       []File     `json:"data"`
	Pagination Pagination `json:"pagination"`
}

type getFingerprintsRequest struct {
	Fingerprints []int `json:"fingerprints"`
}

type fingerprintMatch struct {
	ProjectId   int    `json:"id"`
	File        File   `json:"file"`
	LatestFiles []File `json:"latestFiles"`
}

type fingerprintsMatchResult struct {
	ExactMatches             []fingerprintMatch `json:"exactMatches"`
	ExactFingerprints        []int              `json:"exactFingerprints"`
	PartialMatches           []fingerprintMatch `json:"partialMatches"`
	PartialMatchFingerprints []int              `json:"partialMatchFingerprints"`
	UnmatchedFingerprints    []int              `json:"unmatchedFingerprints"`
	InstalledFingerprints    []int              `json:"installedFingerprints"`
}

type getFingerprintsMatchesResponse struct {
	Data fingerprintsMatchResult `json:"data"`
}

func getPaginatedFilesForProject(projectId int, client httpClient.Doer, cursor int) (*getFilesResponse, error) {
	ctx := context.WithValue(context.Background(), "projectId", projectId)
	region := trace.StartRegion(ctx, "curseforge-getproject")
	defer region.End()

	url := fmt.Sprintf("%s/mods/%d/files?index=%d", GetBaseUrl(), projectId, cursor)
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	response, err := client.Do(request)
	if err != nil {
		return nil, globalErrors.ProjectApiErrorWrap(err, strconv.Itoa(projectId), models.CURSEFORGE)
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotFound {
		return nil, &globalErrors.ProjectNotFoundError{
			ProjectID: strconv.Itoa(projectId),
			Platform:  models.CURSEFORGE,
		}
	}

	if response.StatusCode != http.StatusOK {
		return nil, globalErrors.ProjectApiErrorWrap(errors.Errorf("unexpected status code: %d", response.StatusCode), strconv.Itoa(projectId), models.CURSEFORGE)
	}

	var filesResponse getFilesResponse
	err = json.NewDecoder(response.Body).Decode(&filesResponse)
	if err != nil {
		return nil, err
	}

	return &filesResponse, nil
}

func GetFilesForProject(projectId int, client httpClient.Doer) ([]File, error) {
	var files []File
	cursor := 0
	for {
		filesResponse, err := getPaginatedFilesForProject(projectId, client, cursor)
		if err != nil {
			return nil, err
		}

		files = append(files, filesResponse.Data...)
		if (cursor + filesResponse.Pagination.ResultCount) >= filesResponse.Pagination.TotalCount {
			break
		}

		cursor += filesResponse.Pagination.ResultCount
	}

	return files, nil
}

func GetFingerprintsMatches(fingerprints []int, client httpClient.Doer) (*FingerprintResult, error) {
	ctx := context.WithValue(context.Background(), "fingerprints", fingerprints)
	region := trace.StartRegion(ctx, "curseforge-getfingerprints")
	defer region.End()

	gameId := Minecraft

	url := fmt.Sprintf("%s/fingerprints/%d", GetBaseUrl(), gameId)

	body, _ := json.Marshal(getFingerprintsRequest{Fingerprints: fingerprints})
	request, _ := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(body))

	request.Header.Add("Content-Type", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return nil, globalErrors.ProjectApiErrorWrap(err, "fingerprints", models.CURSEFORGE)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, globalErrors.ProjectApiErrorWrap(errors.Errorf("unexpected status code: %d", response.StatusCode), "fingerprints", models.CURSEFORGE)
	}

	var fingerprintsResponse getFingerprintsMatchesResponse
	err = json.NewDecoder(response.Body).Decode(&fingerprintsResponse)
	if err != nil {
		return nil, err
	}

	result := &FingerprintResult{
		Matches:   make([]File, 0),
		Unmatched: make([]int, 0),
	}

	for _, item := range fingerprintsResponse.Data.ExactMatches {
		result.Matches = append(result.Matches, item.File)
	}

	for _, item := range fingerprintsResponse.Data.UnmatchedFingerprints {
		result.Unmatched = append(result.Unmatched, item)
	}

	return result, nil

}
